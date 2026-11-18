# Wazuh Helm — Architecture Diagrams

## 1. High-Level Topology

```
┌─────────────────────────────────────────────────────────────────────┐
│  Kubernetes Cluster                                                  │
│                                                                      │
│  ┌──────────────┐    alerts (Filebeat/TLS)    ┌──────────────────┐  │
│  │   Manager    │ ──────────────────────────► │    Indexer       │  │
│  │  ┌────────┐  │                             │  ┌────┐ ┌────┐   │  │
│  │  │ Master │  │  ◄── API queries ───────────│  │ N0 │ │ N1 │   │  │
│  │  └────────┘  │                             │  └────┘ └────┘   │  │
│  │  ┌────────┐  │       cluster (1516)         │  ┌────┐          │  │
│  │  │Worker 0│◄─┼──────────────────────────── │  │ N2 │          │  │
│  │  └────────┘  │                             │  └────┘          │  │
│  │  ┌────────┐  │                             └──────────────────┘  │
│  │  │Worker 1│  │                                      ▲            │
│  │  └────────┘  │                             REST (9200/HTTPS)     │
│  └──────────────┘                                      │            │
│         ▲  ▲                               ┌───────────┴──────────┐ │
│  enroll │  │ events                        │    Dashboard         │ │
│  (1515) │  │ (1514)                        │   (port 5601)        │ │
│         │  │                               └──────────────────────┘ │
│  ┌──────┴──┴──────────────────────────┐             ▲               │
│  │  Agent DaemonSet (every node)      │        Ingress /            │
│  └────────────────────────────────────┘        Gateway API          │
│                                                      │               │
└─────────────────────────────────────────────────────┼───────────────┘
                                                       │
                                                    Browser
```

## 2. TLS Certificate Chain

```
  [SelfSigned Issuer]
         │  issues
         ▼
  [Root CA Certificate]  (90d validity, Secret: root-ca-tls)
         │  referenced by
         ▼
  [CA Issuer]
         │  issues all leaf certs
         ├──► node-tls       → Indexer StatefulSet pods
         ├──► admin-tls      → securityadmin Job
         ├──► dashboard-tls  → Dashboard Deployment
         ├──► filebeat-tls   → Manager (Filebeat sidecar)
         └──► api-tls        → Manager API (optional)
```

All leaf certificates have the same `duration` / `renewBefore` as configured in `certificates.*`.

## 3. Kubernetes Service DNS Map

| DNS Name | Service Type | Port | Protocol | Resolved By |
|---|---|---|---|---|
| `<name>-indexer` | ClusterIP | 9200 | HTTPS | Manager, Dashboard, Job |
| `<name>-indexer-nodes` | Headless | 9300 | TCP | Indexer pods (discovery) |
| `<name>-manager-master` | ClusterIP | 1515, 55000 | TCP/HTTPS | Agents, Dashboard |
| `<name>-manager-cluster` | Headless | 1516 | TCP | Master ↔ Workers |
| `<name>-manager-worker` | ClusterIP | 1514 | TCP | Agent DaemonSet |
| `<name>-dashboard` | ClusterIP | 5601 | HTTPS | Ingress / Gateway |
| `<name>-manager-lb` | LoadBalancer | 1514,1515,55000 | TCP | External agents (opt) |

Full DNS format: `<service>.<namespace>.svc.cluster.local`

## 4. Agent Enrollment Sequence

```
Agent Pod (DaemonSet)                Manager Master Pod
      │                                      │
      │── TCP :1515 (authd) ───────────────► │
      │                                      │  verify authd password
      │                                      │  (wazuh-authd-pass Secret)
      │◄── agent ID + key ─────────────────── │
      │                                      │
      │── TCP :1514 (events) ──────────────► Worker Pod
      │                           events processed + forwarded to Indexer
      │
      │── HTTPS :55000 (API) ──────────────► Manager Master
      │   (JOIN_MANAGER_USER / JOIN_MANAGER_PASSWORD from api-cred)
```

## 5. StatefulSet Pod Identity

StatefulSets give each pod a stable identity used for Indexer cluster discovery:

```
<fullname>-indexer-0   →  wazuh-indexer-0.wazuh-indexer-nodes.<ns>.svc.cluster.local
<fullname>-indexer-1   →  wazuh-indexer-1.wazuh-indexer-nodes.<ns>.svc.cluster.local
<fullname>-indexer-2   →  wazuh-indexer-2.wazuh-indexer-nodes.<ns>.svc.cluster.local

<fullname>-manager-master-0   →  stable master pod
<fullname>-manager-worker-0   →  worker-0
<fullname>-manager-worker-1   →  worker-1
```

The `NODE_NAME` env var is sourced from `metadata.name` (fieldRef) so each Indexer pod
registers its own stable hostname with the OpenSearch cluster.

## 6. Manager Init Flow

```
Manager Master Pod start
        │
        ▼
  [initContainer: update-index]
        │  reads: config CM → master.conf + script.sh
        │  writes: merged ossec.conf → emptyDir (result-config)
        │
        ▼
  [main container: wazuh-manager]
        │  reads ossec.conf from result-config emptyDir
        │  mounts: filebeat-certs, api-certs, wazuh-authd-pass
        │
        ▼
  Filebeat sidecar ships alerts to <name>-indexer:9200
```
