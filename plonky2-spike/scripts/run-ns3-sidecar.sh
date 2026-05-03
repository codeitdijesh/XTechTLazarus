#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "${script_dir}/.." && pwd)"
source_file="${repo_dir}/ns3/aegis-manet-sidecar.cc"
export AEGIS_MANET_RUN_DIR="${AEGIS_MANET_RUN_DIR:-${repo_dir}/runs/latest}"
mkdir -p "${AEGIS_MANET_RUN_DIR}"

if [[ -n "${NS3_ROOT:-}" ]]; then
  ns3_root="${NS3_ROOT}"
elif [[ -f "./ns3" && -x "./ns3" && -d "./src" ]]; then
  ns3_root="$(pwd)"
else
  echo "ns-3 not found: set NS3_ROOT to an ns-3 checkout, or set AEGIS_NS3_SIDECAR to a built sidecar binary" >&2
  exit 127
fi

ns3_bin="${NS3_BIN:-${ns3_root}/ns3}"
if [[ ! -x "${ns3_bin}" ]]; then
  echo "ns-3 launcher not executable: ${ns3_bin}" >&2
  exit 127
fi

mkdir -p "${ns3_root}/scratch"
target_file="${ns3_root}/scratch/aegis-manet-sidecar.cc"
if [[ ! -f "${target_file}" ]] || ! cmp -s "${source_file}" "${target_file}"; then
  cp "${source_file}" "${target_file}"
fi

cd "${ns3_root}"
"${ns3_bin}" build --quiet aegis-manet-sidecar >&2
exec "${ns3_bin}" run --no-build --quiet scratch/aegis-manet-sidecar
