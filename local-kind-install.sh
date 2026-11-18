#!/usr/bin/env bash
# local-kind-install.sh — spin up Wazuh 5.0 on a local kind cluster
# Run from the repo root: bash local-kind-install.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
NS=wazuh
CLUSTER=wazuh

# ── colours ──────────────────────────────────────────────────────────
GRN='\033[0;32m'; YLW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GRN}▶ $*${NC}"; }
warn()  { echo -e "${YLW}⚠ $*${NC}"; }
fatal() { echo -e "${RED}✗ $*${NC}" >&2; exit 1; }

# ── prereq check ─────────────────────────────────────────────────────
for cmd in kind kubectl helm docker openssl; do
  command -v "$cmd" &>/dev/null || fatal "'$cmd' not found — install it first"
done

# ── 1. kind cluster ───────────────────────────────────────────────────
if kind get clusters 2>/dev/null | grep -q "^${CLUSTER}$"; then
  warn "kind cluster '${CLUSTER}' already exists — skipping create"
else
  info "Creating kind cluster '${CLUSTER}' (control-plane + 2 workers)..."
  cat <<EOF | kind create cluster --name "$CLUSTER" --config=-
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
  - role: worker
  - role: worker
EOF
fi

kubectl config use-context "kind-${CLUSTER}"

# ── 2. cert-manager ───────────────────────────────────────────────────
if kubectl get ns cert-manager &>/dev/null; then
  warn "cert-manager namespace already exists — skipping install"
else
  info "Installing cert-manager v1.19.3..."
  kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.19.3/cert-manager.yaml
  info "Waiting for cert-manager deployments to be ready..."
  kubectl -n cert-manager wait --for=condition=Available deployment --all --timeout=120s
fi

# ── 3. namespace ──────────────────────────────────────────────────────
kubectl get ns "$NS" &>/dev/null || kubectl create ns "$NS"

# ── 4. passwords & cluster key ────────────────────────────────────────
info "Generating credentials..."
INDEXER_PASS="${INDEXER_PASS:-ChangeMeIndexer1!}"
DASHBOARD_PASS="${DASHBOARD_PASS:-ChangeMeDash1!}"
API_PASS="${API_PASS:-ChangeMeApi1!}"
AUTHD_PASS="${AUTHD_PASS:-ChangeMeAuthd1!}"
CLUSTER_KEY="${CLUSTER_KEY:-$(openssl rand -hex 16)}"

info "Generating bcrypt hash for wazuh-server indexer account (pulls image once)..."
INDEXER_HASH=$(docker run --rm wazuh/wazuh-indexer:5.0.0 \
  bash /usr/share/wazuh-indexer/plugins/opensearch-security/tools/hash.sh \
  -p "$INDEXER_PASS" 2>/dev/null | tail -1)

if [[ "$INDEXER_HASH" != '$2'* ]]; then
  fatal "bcrypt hash generation failed — got: $INDEXER_HASH"
fi
info "Hash OK: ${INDEXER_HASH:0:10}..."

# ── 5. helm install ───────────────────────────────────────────────────
info "Installing Wazuh chart from ${REPO_ROOT}/charts/wazuh ..."
helm upgrade --install wazuh "${REPO_ROOT}/charts/wazuh" \
  --namespace "$NS" \
  --set cert-manager.enabled=false \
  --set certificates.enabled=false \
  --set wazuh.key="$CLUSTER_KEY" \
  --set wazuh.worker.replicas=1 \
  --set wazuh.master.storageSize=5Gi \
  --set wazuh.worker.storageSize=5Gi \
  --set indexer.replicas=1 \
  --set indexer.storageSize=5Gi \
  --set "indexer.config.internalUsers.wazuh-server.hash=${INDEXER_HASH}" \
  --set "indexer.config.internalUsers.wazuh-server.reserved=true" \
  --set "indexer.config.internalUsers.wazuh-server.backend_roles={admin}" \
  --set agent.enabled=false \
  --timeout 10m \
  --wait

# ── 6. verify ─────────────────────────────────────────────────────────
info "Pods:"
kubectl -n "$NS" get pods

info "Checking Phase 3 path question (config dir in 5.0 image)..."
kubectl -n "$NS" exec wazuh-manager-master-0 -- \
  sh -c 'ls /etc/wazuh-manager/ 2>/dev/null && echo "→ NEW PATH /etc/wazuh-manager" || echo "→ STILL /var/ossec"'

info "Indexer cluster health:"
kubectl -n "$NS" exec wazuh-indexer-0 -- \
  curl -sk -u "wazuh-server:${INDEXER_PASS}" \
  https://localhost:9200/_cluster/health | python3 -m json.tool 2>/dev/null || true

echo ""
echo -e "${GRN}════════════════════════════════════════${NC}"
echo -e "${GRN}  Wazuh 5.0 running on kind cluster '${CLUSTER}'${NC}"
echo -e "${GRN}════════════════════════════════════════${NC}"
echo ""
echo "  Dashboard (port-forward):"
echo "    kubectl -n ${NS} port-forward svc/wazuh-dashboard 5601:5601"
echo "    open https://localhost:5601"
echo "    user: admin   pass: ${DASHBOARD_PASS}"
echo ""
echo "  Manager logs:"
echo "    kubectl -n ${NS} logs -f wazuh-manager-master-0"
echo ""
echo "  Tear down:"
echo "    kind delete cluster --name ${CLUSTER}"
