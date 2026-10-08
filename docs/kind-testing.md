# Local Wazuh 4 deployment tests

This profile was tested with Helm 3.19.0, Kind 0.30.0, Kubernetes 1.34.0 and
cert-manager 1.19.3. It deploys the chart's Wazuh 4.14.3 components and
third-party 4.14.1 agent. It does not implement Wazuh 5 support.

Use an isolated Kind cluster named `wazuh-dev`, context `kind-wazuh-dev`,
release `wazuh` and namespace `wazuh-test`. Docker, Helm, kubectl, Kind,
Python 3 and PyYAML are prerequisites.

```bash
export KUBECONFIG=/tmp/wazuh-kind-kubeconfig
kind create cluster --name wazuh-dev --image kindest/node:v1.34.0 \
  --kubeconfig "$KUBECONFIG"
helm dependency build charts/wazuh
helm upgrade --install cert-manager charts/wazuh/charts/cert-manager-v1.19.3.tgz \
  --kube-context kind-wazuh-dev --namespace cert-manager --create-namespace \
  --set crds.enabled=true --wait --timeout 5m
python3 scripts/prepare-kind-values.py /tmp/wazuh-kind-values.yaml
helm upgrade --install wazuh charts/wazuh --kube-context kind-wazuh-dev \
  --namespace wazuh-test --create-namespace --values /tmp/wazuh-kind-values.yaml \
  --wait --timeout 10m
```

The generator refuses to overwrite an existing output. It produces the tested
profile from current chart templates rather than duplicating generated XML in
the repository. Generated files contain chart default credentials and cluster
settings: keep them local and use only an isolated disposable test cluster.
No kubeconfig, credentials, certificates or rendered Secrets belong in Git.

The profile uses one indexer, one master, one worker and three 5Gi PVCs. It
creates service accounts, sets analysis thread counts to one, reduces manager
queues to 4096, limits managers to 4Gi and adds API/analysis readiness checks.
Vulnerability detection is disabled: multi-gigabyte feed downloads exhausted
memory-backed container storage in the Codex workspace. This profile does not
validate vulnerability detection or production sizing.

After the agent reconnects, append one synthetic SSH failure to a monitored log:

```bash
kubectl --context kind-wazuh-dev -n wazuh-test exec wazuh-manager-worker-0 -- \
  sh -c 'printf "%s codex-kind-smoke-final sshd[1234]: Failed password for invalid user codex-kind-smoke-final from 192.0.2.123 port 54321 ssh2\n" "$(date "+%b %e %H:%M:%S")" >> /var/ossec/logs/active-responses.log'
python3 scripts/kind-smoke.py
```

Allow time for log collection and indexing before running the check. It checks
pod readiness, zero restarts in the current managers, verified TLS API
authentication, a connected agent, green indexer/dashboard health and the
synthetic alert in `wazuh-alerts-*`. These checks passed in the Codex workspace;
master/worker communication, certificate issuance and bound PVCs were also
verified. Long-running stability and fresh-workspace restoration were not tested.

Kind's default kindnet does not enforce NetworkPolicies. The third-party agent
disables TLS verification during enrollment and logs tokens/agent keys; avoid
dumping its raw provisioning logs. Harden or replace it before production use.

## Codex workspace limitations

The workspace needed an IPv4 Docker network, a `/dev/kmsg` link to `/dev/console`
inside the node, `vm.max_map_count=262144`, the workspace proxy's public CA
certificates in the node trust store and resolution of the proxy hostname.
Overlayfs upper directories on the workspace disk failed; native snapshots
exhausted disk space. The running test node instead uses containerd root
`/tmp/containerd-workspace` on tmpfs with overlayfs. That image store is not
durable across node restarts. These are environment-specific adjustments;
the ordinary Kind commands above require additional provisioning work in
such a workspace. Do not assume publishing an environment snapshots running
Kubernetes processes or tmpfs. Do not remove PVCs or recreate clusters with
data that should be retained.
