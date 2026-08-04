import bcrypt from 'bcryptjs';
import {
  getSupabaseServiceClient,
  loadEnv,
} from '../src/storage/database/supabase-client';
import { getPasswordValidationError } from '../src/lib/password-policy';

const RETIRED_ADMIN_EMAIL = 'admin@zhipin.com';

async function bootstrapAdmin(): Promise<void> {
  loadEnv();

  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || '系统管理员';
  const organizationName = process.env.BOOTSTRAP_ORGANIZATION_NAME?.trim();
  const organizationSlug = process.env.BOOTSTRAP_ORGANIZATION_SLUG?.trim().toLowerCase();

  if (!email || !email.includes('@')) {
    throw new Error('BOOTSTRAP_ADMIN_EMAIL must be a valid email address');
  }
  if (email === RETIRED_ADMIN_EMAIL) {
    throw new Error(`${RETIRED_ADMIN_EMAIL} is retired and cannot be reused`);
  }
  if (typeof password !== 'string') {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD is required');
  }
  if (!organizationName) {
    throw new Error('BOOTSTRAP_ORGANIZATION_NAME is required');
  }
  if (!organizationSlug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(organizationSlug)) {
    throw new Error('BOOTSTRAP_ORGANIZATION_SLUG must contain lowercase letters, numbers, and hyphens only');
  }

  const passwordError = getPasswordValidationError(password);
  if (passwordError) {
    throw new Error(`BOOTSTRAP_ADMIN_PASSWORD: ${passwordError}`);
  }
  const supabase = getSupabaseServiceClient();
  const { data: existingAdmins, error: lookupError } = await supabase
    .from('organization_members')
    .select('id')
    .eq('role', 'admin')
    .eq('is_active', true)
    .limit(1);

  if (lookupError) {
    throw new Error(`Failed to check existing administrators: ${lookupError.message}`);
  }
  if (existingAdmins && existingAdmins.length > 0) {
    throw new Error('An administrator already exists; bootstrap is only allowed once');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const { data: organization, error: organizationError } = await supabase
    .from('organizations')
    .insert({
      name: organizationName,
      slug: organizationSlug,
      is_active: true,
    })
    .select('id')
    .single();

  if (organizationError || !organization) {
    throw new Error(`Failed to create organization: ${organizationError?.message || 'unknown error'}`);
  }

  const { data: user, error: userError } = await supabase
    .from('users')
    .insert({
      organization_id: organization.id,
      email,
      password_hash: passwordHash,
      name,
      company: organizationName,
      role: 'admin',
      is_active: true,
      must_change_password: true,
    })
    .select('id')
    .single();

  if (userError || !user) {
    await supabase.from('organizations').delete().eq('id', organization.id);
    throw new Error(`Failed to create administrator: ${userError?.message || 'unknown error'}`);
  }

  const { error: membershipError } = await supabase
    .from('organization_members')
    .insert({
      organization_id: organization.id,
      user_id: user.id,
      role: 'admin',
      is_active: true,
    });

  if (membershipError) {
    await supabase.from('users').delete().eq('id', user.id);
    await supabase.from('organizations').delete().eq('id', organization.id);
    throw new Error(`Failed to create administrator membership: ${membershipError.message}`);
  }

  console.log('Administrator created. Sign in with the injected credentials and change the password immediately.');
}

bootstrapAdmin().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
