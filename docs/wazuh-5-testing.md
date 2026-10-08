# Wazuh 5 development and testing

The initial compatibility investigation started on `feature/wazuh-5` from main commit
`1382a8987e995656b86ac5d4562c60cb9ed37c91` (chart 2.0.7).
The initial compatibility target is **5.0.0-rc1**, not a stable release.
The chart still defaults to Wazuh 4.14.3; Wazuh 5 support is not implemented yet.
See the [architecture and Wazuh 5 changes](architecture.md#8-wazuh-5-upstream-changes-and-remaining-chart-work)
for the updated comparison, or use the [printable PDF](architecture-print.pdf).

## Baseline

With Helm 3 and the pinned cert-manager dependency installed:

```bash
helm lint charts/wazuh --strict
SKIP_DEPENDENCY_BUILD=1 bash charts/wazuh/tests/render_test.sh
```

Omit `SKIP_DEPENDENCY_BUILD` to fetch dependencies through the normal Helm
repository. The offline option uses installed dependencies and still runs
strict lint before all assertions. The initial baseline passed 66 assertions.
These tests cover Wazuh 4 rendering; they do not establish Wazuh 5 compatibility.

## Compatibility work

Compare against the immutable upstream RC sources:

- [Kubernetes manifests](https://github.com/wazuh/wazuh-kubernetes/tree/b85e6869db2db81e77fb2a302a887c03a4db7fe0)
- [Docker image entrypoints and deployment examples](https://github.com/wazuh/wazuh-docker/tree/29a8d75c7fe8fe54fde1c4dba4fa6a9e22d29548)

Implement and test the following before deploying this chart with version 5 tags:

- Manager configuration: replace assumptions about `ossec.conf`, `/var/ossec`,
  the `wazuh` user, and control commands with the RC's `wazuh-manager.conf`,
  `/var/wazuh-manager`, `wazuh-manager` user, and manager control command.
- Data forwarding: follow the RC indexer connector configuration rather than
  carrying forward the Wazuh 4 Filebeat override and mounts.
- Credentials: mount per-component Kubernetes Secrets as
  `/run/secrets/wazuh-credentials`, matching upstream credential names and
  first-start behavior. Persist initialized databases/keystores; changing a
  Secret alone does not rotate stored passwords. Review indexer/dashboard root
  initialization and later service-user behavior. Do not commit generated passwords.
- Certificates: provide the manager's indexer connector client certificate
  and remoted HTTPS server certificate with correct SANs and trust chains.
- Services and network policies: expose agent HTTPS communication and
  enrollment on 1517. Treat legacy agent ports as a separate compatibility
  decision; upstream RC examples also retain 1514/1515 in some configurations.
- Agent deployment: choose and verify a compatible Wazuh 5 agent image;
  changing the tag of the current third-party Wazuh 4 agent is insufficient.
  Provision API-issued enrollment tokens, validate certificate SANs and CA trust,
  and persist agent identity so recreating a pod does not enroll a new agent.
- Indexer and dashboard: compare paths, secrets, probes, startup behavior,
  security bootstrap, and persisted data with upstream RC examples.
- Detection content: persist `/var/wazuh-manager/data` and preserve the image's
  refresh rules for packaged schema, enrichment and timezone content.
- Dashboard keystore: persist the configuration directory so credentials and
  the AI assistant encryption key survive pod recreation and image upgrades.

## Dedicated test cluster

Use an explicit context, a separate namespace and release, and fresh PVCs.
Cluster context and namespace must be selected before executing cluster commands.
Do not use existing Wazuh 4 data volumes for the first smoke test.

Validate rendering and server-side dry-run before installation. If cert-manager
is already installed, reuse it instead of installing a second copy.

Acceptance checks after deployment:

1. All components become ready, and startup logs contain no configuration,
   certificate, credential, or permission failures.
2. Authenticated indexer health and manager API requests succeed using verified
   TLS; dashboard authentication and its manager connection succeed.
3. A Wazuh 5 agent enrolls with a valid token over verified HTTPS on 1517 and
   reaches connected status; expired/revoked tokens are rejected.
4. A representative agent event becomes an indexed alert visible in the dashboard.
5. Pod recreation preserves credentials, agent identity, detection content and
   the dashboard keystore, and recovers without manual edits. Test credential
   rotation separately from updating the Kubernetes Secret.
6. Master/worker clustering, archives, external indexer and Gateway/SSO behavior
   are tested as those configurations are implemented.

Report chart assertions separately from live end-to-end results. Kubernetes
readiness alone does not demonstrate successful event ingestion.
