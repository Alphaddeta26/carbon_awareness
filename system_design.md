# Carbon Footprint Awareness Platform: Enterprise System Design

This document details the high-scale, event-driven microservices architecture designed to support millions of calculations, spiky write workloads, and dynamic database shard additions.

---

## 1. System Architecture: Deconstructed Microservices

To handle scale, the monolithic Express app is deconstructed into specialized microservices. This allows independent scaling of memory/CPU resources based on the specific load profiles of each boundary context.

```
[ Client Browser ]
        │
        ▼  (HTTPS)
[ Nginx Reverse Proxy / Load Balancer ]
        │
        ├──────────────────────┬──────────────────────┐
        ▼                      ▼                      ▼
 [ Auth Service ]      [ Ingestion Service ]  [ Leaderboard Service ]
   (Auth Check)          (Spiky writes)         (High-speed reads)
        │                      │                      │
        │                      ▼                      ▼
        │             [ Redis Stream Queue ]    [ Redis Cache ]
        │                      │                      ▲
        │                      ▼                      │ (ZSET Leaderboard)
        │              [ Worker Service ] ────────────┘
        │                      │
        └──────────┬───────────┘
                   ▼ (VNode Hash Ring)
           ┌───────┴───────┐
           ▼               ▼
     [ DB Shard 1 ]  [ DB Shard 2 ]
```

### Microservice Definitions
1. **Auth Service**: Manages user accounts, hashing passwords using `bcrypt`, and generating signed JSON Web Tokens (JWT).
2. **Ingestion Service**: Exposes write endpoints. It validates calculator input payloads and pushes footprint logs onto a message queue. It returns a `202 Accepted` status immediately, completing requests in $<5\text{ms}$.
3. **Worker Service**: A background daemon that pulls logs from the message queue, routes them to database shards, and syncs the Redis leaderboard.
4. **Leaderboard Service**: Exposes public read endpoints to fetch the top 10 carbon champions directly from Redis.

---

## 2. Consistent Hashing Ring with Virtual Nodes (VNodes)

In standard modulo sharding ($Hash(key) \pmod N$), adding a new database shard invalidates almost all cached keys, forcing a massive, expensive data migration. We upgrade this to a **Consistent Hash Ring** with **Virtual Nodes (VNodes)**.

### The Consistent Hash Ring
- We map a 32-bit integer keyspace $[0, 2^{32}-1]$ onto a virtual circle (ring).
- Both database shards and user keys are hashed onto this ring.
- A key is routed to the first database shard encountered moving clockwise on the ring.

```
          [ Shard 1 - VNode A ] (Hash: 100,000)
                 /             \
  [ User Key ]  /               \  [ Shard 2 - VNode A ] (Hash: 1,200,000)
(Hash: 1,800,000)               /
                \              /
         [ Shard 1 - VNode B ] (Hash: 2,500,000)
```

### Virtual Nodes (VNodes)
To prevent "hotspots" (uneven distribution of keys due to poor hash scattering), we introduce **Virtual Nodes**:
- Instead of hashing a shard once, each physical shard is hashed multiple times (e.g., 100 VNodes per shard) using string suffixes: `shard-1#1`, `shard-1#2`, etc.
- This interleaves physical databases across the ring, guaranteeing a highly uniform distribution of user keys.
- **Dynamic Re-sharding**: When adding a physical Shard 3, we hash its VNodes onto the ring. Only a fraction ($1/N$) of existing keys are re-routed to Shard 3, leaving the remaining $83\%$ of data completely untouched.

---

## 3. Asynchronous Write-Behind Queue

Direct database writes during traffic spikes saturate connection pools. We decouple the ingestion service using a **Write-Behind Queue** backed by Redis Streams.

### Operation Pipeline
1. **Ingestion**: The user submits travel, energy, food, and waste values. The Ingestion Service pushes a task onto the queue using `LPUSH` or Redis Streams. It instantly returns a `202 Accepted` success response.
2. **Buffering**: The queue buffers tasks, acting as a load-leveler during peaks.
3. **Execution**: The Worker Service pulls tasks sequentially using `RPOPLPUSH` (guaranteeing reliable delivery), processes the carbon math, resolves the correct SQL shard, and saves the history log.
4. **Rate Limiting**: IP-based rate limiting is implemented via Redis to prevent DDOS abuse.

---

## 4. Production Cloud Infrastructure Blueprint (AWS)

1. **ECS Fargate Clusters**: Run separate auto-scaling service groups for `auth`, `ingestion`, `leaderboard`, and `worker`.
2. **Amazon MemoryDB / ElastiCache (Redis)**: High-performance caching and event stream queueing.
3. **Amazon Aurora Serverless v2 PostgreSQL**: Multi-shard database cluster split into private subnets, using AWS Secrets Manager for credential rotation.
