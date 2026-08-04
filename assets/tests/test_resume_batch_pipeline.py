import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import resume_batch_pipeline as pipeline
import resume_batch_worker as worker


class ResumeBatchPipelineTests(unittest.TestCase):
    def test_col_letter(self):
        self.assertEqual(pipeline.col_letter(0), "A")
        self.assertEqual(pipeline.col_letter(25), "Z")
        self.assertEqual(pipeline.col_letter(26), "AA")
        self.assertEqual(pipeline.col_letter(51), "AZ")

    def test_locate_columns_uses_named_columns(self):
        logs = []
        self.assertEqual(
            pipeline.locate_columns(["序号", "姓名", "推荐理由"], logs.append),
            (1, 2),
        )
        self.assertEqual(logs, [])

    def test_locate_columns_defaults_to_h(self):
        logs = []
        self.assertEqual(
            pipeline.locate_columns(["姓名", "状态"], logs.append),
            (0, 7),
        )
        self.assertIn("H", logs[0])

    def test_resolve_llm_config_uses_project_environment(self):
        with patch.dict(
            os.environ,
            {
                "LLM_API_KEY": "test-key",
                "LLM_MODEL": "text-model",
                "RESUME_VL_MODEL": "vision-model",
            },
            clear=True,
        ):
            config = pipeline.resolve_llm_config()
        self.assertEqual(config["api_key"], "test-key")
        self.assertEqual(config["text_model"], "text-model")
        self.assertEqual(config["vision_model"], "vision-model")

    def test_build_prompt_uses_custom_style_without_copying_default(self):
        prompt = pipeline.build_prompt(
            "【一句话画像】示例结构",
            "推荐方向:后端工程师",
            "候选人真实简历",
        )
        self.assertIn("【一句话画像】示例结构", prompt)
        self.assertIn("推荐方向:后端工程师", prompt)
        self.assertIn("候选人真实简历", prompt)
        self.assertNotIn("太原师范学院", prompt)

    def test_worker_decrypts_node_encryption_format(self):
        encrypted = (
            "enc:v1:aes256gcm:"
            "cwjW1vCV3PsY8zlA:"
            "8+ynqyYq8eYN0QbPOozaJPRxWpmAPmYeaxal0s1+ijpGeIwZ:"
            "ROwpZ2BTjz2Jypg0+lezag=="
        )
        with patch.dict(
            os.environ,
            {
                "ENCRYPTION_KEY": (
                    "000102030405060708090a0b0c0d0e0f"
                    "101112131415161718191a1b1c1d1e1f"
                )
            },
            clear=False,
        ):
            value = worker.decrypt_field(encrypted)
        self.assertEqual(value, "https://example.test/mcp?token=dummy")

    def test_worker_auto_detects_second_organization_credential(self):
        supabase = MagicMock()
        supabase.table.return_value.select.return_value.eq.return_value.order.return_value.execute.return_value = SimpleNamespace(
            data=[
                {"id": "cred-1", "name": "组织一", "mcp_url_encrypted": "encrypted-1"},
                {"id": "cred-2", "name": "组织二", "mcp_url_encrypted": "encrypted-2"},
            ]
        )
        log = MagicMock()
        with (
            tempfile.TemporaryDirectory() as temp_dir,
            patch.object(worker, "decrypt_field", side_effect=["https://mcp.one", "https://mcp.two"]),
            patch.object(worker, "write_mcporter_config"),
            patch.object(
                worker,
                "mcp_call",
                side_effect=[pipeline.PipelineError("无权限"), {"sheets": []}],
            ) as mcp_call,
            patch.object(worker, "update_task") as update_task,
        ):
            credential_id = worker.detect_credential(
                supabase,
                {
                    "id": "task-1",
                    "organization_id": "org-1",
                    "sheet_url": "https://alidocs.example/sheet",
                },
                Path(temp_dir),
                log,
            )

        self.assertEqual(credential_id, "cred-2")
        update_task.assert_called_once_with(
            supabase,
            "task-1",
            {"credential_id": "cred-2"},
        )
        self.assertEqual(mcp_call.call_count, 2)

    def test_worker_collects_storage_paths_before_processing(self):
        self.assertEqual(
            worker.task_storage_paths({
                "files": [
                    {"storage_path": "org/task/input/1.pdf"},
                    {"name": "missing-path.pdf"},
                ],
            }),
            ["org/task/input/1.pdf"],
        )

    def test_dry_run_generates_without_writing(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            (folder / "张三.pdf").write_bytes(b"%PDF-test")
            logs = []
            with (
                patch.dict(
                    os.environ,
                    {
                        "AI_EXECUTION_MODE": "private_endpoint",
                        "LLM_API_KEY": "test-key",
                        "LLM_BASE_URL": "https://model.internal/v1",
                    },
                    clear=False,
                ),
                patch.object(
                    pipeline,
                    "load_sheet",
                    return_value=(
                        "sheet-1",
                        [
                            ["姓名", "推荐方向", "推荐理由"],
                            ["张三", "后端工程师", ""],
                        ],
                    ),
                ),
                patch.object(
                    pipeline,
                    "extract_pdf_text",
                    return_value="A" * 300,
                ),
                patch.object(
                    pipeline,
                    "llm_chat",
                    return_value="【基本信息】测试\n【经验&匹配】测试\n【亮点】测试",
                ),
                patch.object(pipeline, "mcp_call") as mcp_call,
            ):
                report = pipeline.run_pipeline(
                    folder,
                    "node-id",
                    dry_run=True,
                    log=logs.append,
                )
        self.assertEqual(report["processed"], ["张三"])
        self.assertEqual(report["written"], [])
        self.assertEqual(report["generated"][0]["cell"], "C2")
        mcp_call.assert_not_called()

    def test_consecutive_rows_are_written_in_one_batch(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            (folder / "张三.pdf").write_bytes(b"%PDF-test")
            (folder / "李四.pdf").write_bytes(b"%PDF-test")
            with (
                patch.dict(
                    os.environ,
                    {
                        "AI_EXECUTION_MODE": "private_endpoint",
                        "LLM_API_KEY": "test-key",
                        "LLM_BASE_URL": "https://model.internal/v1",
                    },
                    clear=False,
                ),
                patch.object(
                    pipeline,
                    "load_sheet",
                    return_value=(
                        "sheet-1",
                        [
                            ["姓名", "推荐方向", "推荐理由"],
                            ["张三", "后端工程师", ""],
                            ["李四", "前端工程师", ""],
                        ],
                    ),
                ),
                patch.object(pipeline, "extract_pdf_text", return_value="A" * 300),
                patch.object(pipeline, "llm_chat", return_value="推荐理由"),
                patch.object(pipeline, "mcp_call") as mcp_call,
            ):
                report = pipeline.run_pipeline(
                    folder,
                    "node-id",
                    workers=2,
                )

        self.assertEqual(report["written"], ["张三", "李四"])
        self.assertEqual(mcp_call.call_count, 1)
        arguments = mcp_call.call_args.args[2]
        self.assertEqual(arguments["rangeAddress"], "C2:C3")
        self.assertEqual(arguments["values"], [["推荐理由"], ["推荐理由"]])


if __name__ == "__main__":
    unittest.main()
