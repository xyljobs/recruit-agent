import { redirect } from 'next/navigation';

export default function HomePage() {
  // App Router 的 redirect() 会自动补 basePath，不要再手动加前缀
  redirect('/jobs');
}
