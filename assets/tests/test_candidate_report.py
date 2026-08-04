import base64
import json
import tempfile
import unittest
from pathlib import Path

from candidate_report import _external_candidate_profile, _redact_external_text, generate_report


class CandidateReportCoverageTest(unittest.TestCase):
    def test_external_profile_excludes_identity_company_and_raw_resume(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            candidate_dir = Path(temp_dir)
            (candidate_dir / "resume.txt").write_text(
                "张某\n电话：13800138000\n邮箱：zhang@example.com\n"
                "某科技公司 Java高级开发\nSpring Boot 微服务 Kafka Docker",
                encoding="utf-8",
            )

            _, profile = _external_candidate_profile(
                candidate_dir,
                {"global_index": 1, "name": "张某"},
                1,
                "招聘Java高级开发，要求Spring Boot、微服务、Kafka",
            )
            serialized = json.dumps(profile, ensure_ascii=False)

            self.assertNotIn("张某", serialized)
            self.assertNotIn("某科技公司", serialized)
            self.assertNotIn("13800138000", serialized)
            self.assertNotIn("zhang@example.com", serialized)
            self.assertNotIn("resume", profile)
            self.assertIn("Spring Boot", profile["skills"])
            redacted = _redact_external_text("电话：13800138000 邮箱：zhang@example.com")
            self.assertNotIn("13800138000", redacted)
            self.assertNotIn("zhang@example.com", redacted)

    def test_partial_resume_data_still_generates_full_report(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            task_dir = Path(temp_dir)
            complete_dir = task_dir / "java" / "01_张某"
            incomplete_dir = task_dir / "java" / "02_李某"
            complete_dir.mkdir(parents=True)
            incomplete_dir.mkdir(parents=True)
            (complete_dir / "resume.txt").write_text(
                "张某\n32岁 · 8年 · 本科\n工作经历\n某科技公司 Java高级开发\n"
                "Spring Boot 微服务 MySQL Redis Docker\n项目经历\n订单系统性能优化",
                encoding="utf-8",
            )
            (complete_dir / "1.png").write_bytes(base64.b64decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
                "+A8AAQUBAScY42YAAAAASUVORK5CYII="
            ))
            (task_dir / "manifest.json").write_text(json.dumps({
                "candidates": [
                    {
                        "global_index": 1,
                        "name": "张某",
                        "keyword_dir": "java",
                        "dir": "01_张某",
                        "status": "ok",
                        "shots": 1,
                    },
                    {
                        "global_index": 2,
                        "name": "李某",
                        "keyword_dir": "java",
                        "dir": "02_李某",
                        "status": "ok",
                    },
                ],
            }, ensure_ascii=False), encoding="utf-8")

            report_path = generate_report(task_dir, {
                "jd_content": "Java高级开发，5年以上，本科，Spring Boot、微服务、MySQL、Redis",
                "keywords": [{"keyword": "杭州 Java高级开发", "count": 2}],
            })

            analysis = json.loads((task_dir / "analysis.json").read_text(encoding="utf-8"))
            manifest = json.loads((task_dir / "manifest.json").read_text(encoding="utf-8"))
            report = report_path.read_text(encoding="utf-8")
            self.assertEqual(analysis["coverage"], {
                "total_candidates": 2,
                "evaluated_candidates": 1,
                "excluded_candidates": 1,
            })
            self.assertEqual(analysis["invalid_count"], 1)
            self.assertEqual(manifest["report_coverage"]["excluded_candidates"], 1)
            self.assertIn("李某", analysis["invalid_reason"])
            self.assertIn("批次画像", report)
            self.assertIn("候选人对比矩阵", report)
            self.assertIn("Top 推荐", report)
            self.assertIn("完整候选人列表", report)
            self.assertIn("市场观察", report)
            self.assertIn("李某", report)
            self.assertIn('id="resume-1"', report)
            self.assertIn("data:image/png;base64,", report)
            self.assertIn("const RESUME_URL_TEMPLATE = null;", report)
            self.assertNotIn("__KPI_TOTAL__", report)


if __name__ == "__main__":
    unittest.main()
