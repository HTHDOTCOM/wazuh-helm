# Architecture — Component Interaction Diagrams

This file provides detailed diagrams of how Wazuh components communicate inside the Kubernetes cluster.

---

## 1. High-Level Topology

```
External Users
     │
     │ HTTPS 443
     ▼
┌─────────────────┐
│  Ingress / LB   │
└────────┬────────┘
         │ HTTP 5601
         ▼
┌─────────────────────┐       REST 9200 (TLS)      ┌──────────────────────────┐
│  Wazuh Dashboard    │ ◄────────────────────────► │   Wazuh Indexer          │
│  Deployment (x1)    │                             │   StatefulSet (x3)       │
│  Port: 5601         │                             │   Ports: 9200, 9300, 9600│
└─────────────────────┘                             └──────────────────────────┘
                                                              ▲
                                                              │ 9200 (TLS) — Filebeat
                                        ┌─────────────────────┤
                                        │                      │
                              ┌─────────┴───────┐   ┌─────────┴───────┐
                              │  Manager Master  │   │  Manager Workers │
                              │  StatefulSet (x1)│   │  StatefulSet (x2)│
                              │  Ports:          │   │  Ports:          │
                              │    55000 (API)   │   │    1514 (events) │
                              │    1515 (enroll) │   │    1515 (enroll) │
                              │    514 (syslog)  │   │    514 (syslog)  │
                              └─────────────────┘   └────────┬────────┘
                                                             ▲
                                                             │ TCP 1514/1515
                                         ┌───────────────────┴──────────────────┐
                                         │   Wazuh Agent DaemonSet               │
                                         │   (one pod per Kubernetes node)        │
                                         │   Mounts: /var/log /proc /sys /etc    │
                                         └───────────────────────────────────────┘
```

---

## 2. Internal Service Resolution

Kubernetes DNS resolves services as `<service-name>.<namespace>.svc.cluster.local`.

| Source | Destination | DNS name | Port |
|---|---|---|---|
| Dashboard | Indexer REST | `wazuh-indexer.<ns>.svc.cluster.local` | 9200 |
| Manager (Filebeat) | Indexer REST | `wazuh-indexer.<ns>.svc.cluster.local` | 9200 |
| Indexer pod 0 | Indexer pod 1 | `wazuh-indexer-1.wazuh-indexer-nodes.<ns>` | 9300 |
| Agent | Manager worker | `wazuh-manager-workers.<ns>.svc.cluster.local` | 1514 |
| Agent enrollment | Manager master | `wazuh-manager-master.<ns>.svc.cluster.local` | 1515 |
| Dashboard | Manager API | `wazuh-manager-master.<ns>.svc.cluster.local` | 55000 |

---

## 3. TLS Certificate Flow

```
cert-manager SelfSigned Issuer
        │
        │ issues
        ▼
  Root CA Secret  (wazuh-rootca-secret)
        │
        │ used by
        ▼
  CA Issuer  (wazuh-ca-issuer)
        │
        ├──► wazuh-indexer-cert   → mounted into Indexer pods
        ├──► wazuh-admin-cert     → used by init Job to bootstrap security
        ├──► wazuh-dashboard-cert → mounted into Dashboard pods
        └──► wazuh-filebeat-cert  → mounted into Manager pods (Filebeat)
```

Each Certificate object produces a Kubernetes Secret. Cert-manager automatically rotates them `360h` before expiry.

---

## 4. Agent Enrollment Sequence

```
Agent Pod (DaemonSet)
    │
    │ 1. POST /agents (HTTP/1515) with authd password
    ▼
Manager Master Service
    │
    │ 2. Validates authd password, issues agent key
    ▼
Agent Pod
    │
    │ 3. Connects to Manager Worker on TCP 1514
    │    and streams events
    ▼
Manager Worker Pod
    │
    │ 4. Processes, enriches, and forwards to Indexer via Filebeat
    ▼
Indexer (OpenSearch)
```

---

## 5. StatefulSet Pod Identity

StatefulSets provide stable network identities. Each pod is addressable by index:

**Indexer:**
- `wazuh-indexer-0.wazuh-indexer-nodes`
- `wazuh-indexer-1.wazuh-indexer-nodes`
- `wazuh-indexer-2.wazuh-indexer-nodes`

**Manager Workers:**
- `wazuh-manager-worker-0.wazuh-manager-workers`
- `wazuh-manager-worker-1.wazuh-manager-workers`

This is used by OpenSearch for cluster bootstrapping (`discovery.seed_hosts`) and by the Wazuh manager cluster (`nodes`).
