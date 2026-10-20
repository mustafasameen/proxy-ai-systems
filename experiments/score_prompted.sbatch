#!/bin/bash
#SBATCH --job-name=score_prompted
#SBATCH --nodes=1 --ntasks=1 --cpus-per-task=6
#SBATCH --mem=48gb
#SBATCH --gpus=1
#SBATCH --time=01:00:00
#SBATCH --output=%x_%j.out
#SBATCH --mail-type=NONE
set -euo pipefail

# Scores the development questions with the prompted 8B model on one GPU.
#   sbatch [--account=... --partition=... --qos=...] experiments/score_prompted.sbatch [run1|run2|both]
# The account, partition and QoS are not set here. Submit from the repository root.
# Needs the question file PROXY_TARGETS (build it with: python experiments/score_prompted.py --build-only) and the model
# files in the Hugging Face cache. Writes PROXY_OUT/{run1,run2}_predictions.jsonl and PROXY_OUT/{run1,run2}_run.json.
# The memory request covers the 16 GB of weights plus the page cache that loading them fills.
#   PROXY_SETUP  optional shell file that activates the environment (hpc/requirements_hpc.txt), sourced first
#   PROXY_TARGETS, PROXY_OUT, PROXY_MODEL, PROXY_REVISION  see experiments/score_prompted.py

WHICH="${1:-both}"
[ -n "${PROXY_SETUP:-}" ] && source "$PROXY_SETUP"

export PYTHONUNBUFFERED=1
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
export VLLM_WORKER_MULTIPROC_METHOD=spawn
export VLLM_BATCH_INVARIANT=1
export OMP_NUM_THREADS="${SLURM_CPUS_PER_TASK:-6}"
export TOKENIZERS_PARALLELISM=false
export PROXY_TARGETS="${PROXY_TARGETS:-results/targets/dev_rows.jsonl}"
export PROXY_OUT="${PROXY_OUT:-results/module7}"

[ -f "$PROXY_TARGETS" ] || { echo "missing question file $PROXY_TARGETS"; exit 2; }

echo "=== host $(hostname)  $(date) ==="
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
python -c "import vllm, torch; print('vllm', vllm.__version__, 'torch', torch.__version__, 'cuda', torch.cuda.is_available())"

echo "############ PREFLIGHT (no model, 8 rows) ############"
python experiments/score_prompted.py --dry-run --limit 8 --out-dir "$PROXY_OUT/_preflight"
python experiments/score_prompted.py --dry-run --limit 8 --distance-cue --name run2 --out-dir "$PROXY_OUT/_preflight"
rm -rf "$PROXY_OUT/_preflight"

echo "############ SCORING ############"
if [ "$WHICH" = run1 ] || [ "$WHICH" = both ]; then
  python experiments/score_prompted.py --name run1
fi
if [ "$WHICH" = run2 ] || [ "$WHICH" = both ]; then
  python experiments/score_prompted.py --name run2 --distance-cue
fi
