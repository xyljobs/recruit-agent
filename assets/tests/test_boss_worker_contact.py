import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import boss_worker
from boss_worker import _contact_candidate, _contact_output_dir


class BossWorkerContactTest(unittest.TestCase):
    def test_contact_candidate_uses_global_index(self) -> None:
        task = {
            "manifest": {
                "candidates": [
                    {"global_index": 2, "index": 1, "status": "ok"},
                ],
            },
        }

        self.assertEqual(_contact_candidate(task, 2), task["manifest"]["candidates"][0])
        self.assertIsNone(_contact_candidate(task, 1))

    def test_contact_output_dir_stays_inside_resume_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            resume_root = Path(temp_dir)
            output_dir = resume_root / "task-1" / "杭州_Java"
            output_dir.mkdir(parents=True)
            with patch.object(boss_worker, "RESUME_DIR", resume_root):
                resolved, candidate_index = _contact_output_dir(
                    {"task_dir": "task-1"},
                    {"keyword_dir": "杭州_Java", "index": 2},
                )

            self.assertEqual(resolved, output_dir.resolve())
            self.assertEqual(candidate_index, 2)

    def test_contact_output_dir_rejects_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(boss_worker, "RESUME_DIR", Path(temp_dir)):
                with self.assertRaisesRegex(RuntimeError, "定位信息不完整"):
                    _contact_output_dir(
                        {"task_dir": "../outside"},
                        {"keyword_dir": "杭州_Java", "index": 1},
                    )


if __name__ == "__main__":
    unittest.main()
