import json
import unittest

from boss import is_logged_out_url, summarize_multi_search
from boss_worker import parse_batch_result, result_task_dir_name, search_error_message


class BossSearchResultTest(unittest.TestCase):
    def test_bticket_redirect_is_treated_as_expired_login(self) -> None:
        self.assertTrue(is_logged_out_url("https://www.zhipin.com/web/user/?ka=bticket"))
        self.assertFalse(is_logged_out_url("https://www.zhipin.com/web/chat/search?keywords=Java"))

    def test_parse_batch_result_uses_final_unified_result(self) -> None:
        first = {"status": "error", "candidates": []}
        final = {"status": "done", "task_dir": "简历/2026-07-22_220000", "candidates": [{"status": "ok"}]}
        stdout = (
            "===BATCH_RESULT_JSON===\n"
            + json.dumps(first)
            + "\n===BATCH_RESULT_END===\n"
            + "===BATCH_RESULT_JSON===\n"
            + json.dumps(final)
            + "\n===BATCH_RESULT_END===\n"
        )

        result = parse_batch_result(stdout)

        self.assertEqual(result, final)
        self.assertEqual(result_task_dir_name(result), "2026-07-22_220000")

    def test_zero_candidates_is_a_failed_search(self) -> None:
        summary = summarize_multi_search([
            {"status": "error", "error": "搜索后 0 候选人(无结果/被风控)"},
        ], [])

        self.assertEqual(summary["status"], "error")
        self.assertEqual(summary["exit_code"], 2)
        self.assertIn("0 候选人", summary["error"])
        self.assertEqual(search_error_message(summary, "", 2), summary["error"])

    def test_partial_failures_still_return_valid_candidates(self) -> None:
        summary = summarize_multi_search([
            {"status": "done"},
            {"status": "error", "error": "第二组无结果"},
        ], [
            {"status": "ok"},
            {"status": "failed"},
        ])

        self.assertEqual(summary["status"], "done")
        self.assertEqual(summary["exit_code"], 0)
        self.assertEqual(summary["succeeded"], 1)
        self.assertEqual(summary["failed"], 1)


if __name__ == "__main__":
    unittest.main()
