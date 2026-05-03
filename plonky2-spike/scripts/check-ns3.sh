#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${AEGIS_NS3_SIDECAR:-}" ]]; then
  if [[ -x "${AEGIS_NS3_SIDECAR}" ]]; then
    echo "AEGIS_NS3_SIDECAR=${AEGIS_NS3_SIDECAR}"
    exit 0
  fi
  echo "AEGIS_NS3_SIDECAR is set but not executable: ${AEGIS_NS3_SIDECAR}" >&2
  exit 1
fi

if [[ -z "${NS3_ROOT:-}" ]]; then
  echo "NS3_ROOT is not set. Point it at an ns-3 checkout, for example: export NS3_ROOT=/opt/ns-3-dev" >&2
  exit 1
fi

if [[ ! -x "${NS3_ROOT}/ns3" ]]; then
  echo "No executable ns3 launcher at ${NS3_ROOT}/ns3" >&2
  exit 1
fi

if [[ ! -d "${NS3_ROOT}/src/aodv" || ! -d "${NS3_ROOT}/src/wifi" ]]; then
  echo "The ns-3 checkout is missing required aodv or wifi modules" >&2
  exit 1
fi

echo "ns-3 OK: ${NS3_ROOT}"
