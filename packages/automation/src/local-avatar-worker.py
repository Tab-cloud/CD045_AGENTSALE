"""Render one owner-scoped talking-head job with locally installed MeloTTS and SadTalker."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import traceback


def write_result(folder: Path, status: str, message: str) -> None:
    target = folder / "worker-result.json"
    temporary = folder / "worker-result.tmp"
    temporary.write_text(json.dumps({"status": status, "message": message}, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, target)


def main() -> None:
    job = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    folder = Path(job["output"])
    try:
        (folder / "worker-stage.txt").write_text("正在生成中文配音", encoding="utf-8")
        from melo.api import TTS

        audio = folder / "speech.wav"
        model = TTS(language="ZH", device="auto")
        model.tts_to_file(job["script"], model.hps.data.spk2id["ZH"], str(audio), speed=1.0)
        (folder / "worker-stage.txt").write_text("配音已完成，正在驱动人像与口型", encoding="utf-8")
        rendered = folder / "rendered"
        rendered.mkdir(exist_ok=True)
        command = [
            job["python"], "inference.py", "--driven_audio", str(audio),
            "--source_image", job["portrait"], "--result_dir", str(rendered),
        ]
        with (folder / "worker.log").open("w", encoding="utf-8") as log:
            subprocess.run(command, cwd=job["repo"], stdout=log, stderr=subprocess.STDOUT, check=True, timeout=1800)
        videos = sorted(rendered.rglob("*.mp4"), key=lambda item: item.stat().st_mtime, reverse=True)
        if not videos:
            raise RuntimeError("SadTalker 未输出视频")
        if videos[0].stat().st_size > 100_000_000:
            raise RuntimeError("生成视频超过 100 MB")
        shutil.copyfile(videos[0], folder / "video.mp4.part")
        os.replace(folder / "video.mp4.part", folder / "video.mp4")
        write_result(folder, "completed", "数字人口播已完成")
    except Exception:
        with (folder / "worker-error.log").open("w", encoding="utf-8") as log:
            traceback.print_exc(file=log)
        write_result(folder, "failed", "本地模型生成失败；请管理员查看该任务的 worker-error.log 和 worker.log")


if __name__ == "__main__":
    main()
