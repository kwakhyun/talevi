"""Export only reviewed portfolio documents and screenshots; never source or logs."""

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / ".local" / "talevi-portfolio"
FILES = {
    "docs/portfolio/README.md": "README.md",
    "docs/portfolio/ENGINEERING.md": "ENGINEERING.md",
    "docs/portfolio/VALIDATION.md": "VALIDATION.md",
    "docs/portfolio/evaluation-summary.json": "evaluation-summary.json",
    "RIGHTS.md": "RIGHTS.md",
}
SCREENSHOTS = (
    "talevi-icon.png",
    "discover.jpg",
    "characters-women.jpg",
    "characters-men.png",
    "character-preview.jpg",
    "chat-memory.png",
    "mobile-discover.png",
    "mobile-relationship.png",
)


def main():
    files = {
        **FILES,
        **{f"docs/screenshots/{name}": f"assets/screenshots/{name}" for name in SCREENSHOTS},
    }
    # A separate Git history is expected here; all other unexpected files block export.
    allowed = {*files.values(), "publication-manifest.json"}
    if DESTINATION.exists():
        unexpected = [
            str(p.relative_to(DESTINATION))
            for p in DESTINATION.rglob("*")
            if p.is_file()
            and ".git" not in p.relative_to(DESTINATION).parts
            and p.relative_to(DESTINATION).as_posix() not in allowed
        ]
        if unexpected:
            raise SystemExit(f"Unexpected public export files: {unexpected}")
    hashes = {}
    for source, target in files.items():
        output = DESTINATION / target
        output.parent.mkdir(parents=True, exist_ok=True)
        content = (ROOT / source).read_bytes()
        if target == "README.md":
            content = (
                content.decode()
                .replace("../screenshots/", "assets/screenshots/")
                .replace("../../RIGHTS.md", "RIGHTS.md")
                .encode()
            )
        output.write_bytes(content)
        hashes[target] = hashlib.sha256(content).hexdigest()
    (DESTINATION / "publication-manifest.json").write_text(
        json.dumps({"files_sha256": hashes}, ensure_ascii=False, indent=2) + "\n"
    )
    print(f"Exported {len(files)} reviewed files and one manifest to {DESTINATION}")


if __name__ == "__main__":
    main()
