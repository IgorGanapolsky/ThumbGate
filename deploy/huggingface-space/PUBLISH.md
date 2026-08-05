# Publish ThumbGate to Hugging Face Spaces

Live Space: https://huggingface.co/spaces/IgorGanapolsky/ThumbGate

## Auth

Write token stored in `~/.cache/huggingface/token` (account: `thumbgate-spaces-publish`).
Do not commit tokens.

```bash
export HF_TOKEN="$(cat ~/.cache/huggingface/token)"
# or: huggingface-cli login
```

## Create / update Space

```bash
python - <<'PY'
from huggingface_hub import HfApi
from pathlib import Path
api = HfApi()
repo_id = 'IgorGanapolsky/ThumbGate'
root = Path('deploy/huggingface-space')
for name in ['README.md', 'index.html']:
    api.upload_file(
        path_or_fileobj=str(root / name),
        path_in_repo=name,
        repo_id=repo_id,
        repo_type='space',
        commit_message=f'chore: sync {name} from ThumbGate repo',
    )
print('https://huggingface.co/spaces/' + repo_id)
PY
```

## Sample dataset

Live: https://huggingface.co/datasets/IgorGanapolsky/thumbgate-agent-feedback-sample

Sources: `deploy/huggingface-dataset-sample/`.

## Directory listing proof

```bash
curl -s 'https://huggingface.co/api/spaces?search=ThumbGate&limit=5'
curl -s 'https://huggingface.co/api/datasets?search=ThumbGate&limit=5'
```
