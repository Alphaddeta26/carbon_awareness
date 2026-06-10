# Carbon Footprint Awareness Platform: System Design Document

This document details the system design, scalability features, caching architecture, database sharding strategies, security measures, and deployment blueprint for the scalable Carbon Footprint Awareness Platform.

---

## 1. System Architecture Overview

The system uses a highly decoupled, service-oriented architecture designed to scale under heavy traffic workloads (millions of calculations and dashboard views per day).

```
[ Client Browsers ]
         │
         ▼  (HTTPS / WSS)
[ Nginx Reverse Proxy / Load Balancer ]
         │
         ├──────────────────────┬──────────────────────┐
         ▼                      ▼                      ▼
[ App Node 1 ]           [ App Node 2 ]          [ App Node 3 ]  (Express API Cluster)
         │                      │                      │
         ├──────────────────────┴──────────────────────┤
         ├───► [ Redis Cluster ] (Sessions, Rate Limit, Leaderboard Sorted Sets)
         │
         ▼  (DB Router: MurmurHash3 modulo sharding)
  ┌──────┴──────────────────────┐
  ▼                             ▼
[ PostgreSQL Shard A ]     [ PostgreSQL Shard B ]
```

### Technology Stack
- **Frontend**: Lightweight SPA (HTML5, Vanilla CSS3, Vanilla JS, SVG charting) served statically or by Node.
- **Backend API**: Node.js & Express (Asynchronous, event-driven, single-threaded I/O loop).
- **Cache / In-Memory DB**: Redis (In-memory storage for high-speed rate limiting, sessions, and leaderboard operations).
- **Primary Database**: PostgreSQL cluster (Horizontal sharding for scale).
- **Infrastructure**: Docker & Docker Compose (for complete local deployability and replication).

---

## 2. Database Sharding Strategy

For a global platform tracking millions of carbon footprint entries, a single relational database instance becomes a write bottleneck. We implement a horizontal database sharding architecture.

### Partitioning Key Selection
- **Key**: `user_id` (UUIDv4).
- **Rationale**: Distributes reads and writes evenly across database shards. A hash function resolves queries for a specific user to a single database server, preventing cross-shard joins for core user footprint histories.

### Sharding Router Algorithm
We use **Consistent Hashing / Modulo Sharding** on the client connection driver level:
1. Extract `user_id` from request token.
2. Hash user ID using MD5 or MurmurHash3 to get a 32-bit integer.
3. Compute `ShardIndex = Hash(user_id) % NumberOfShards`.
4. Route SQL statement (Read/Write) to the database connection pool corresponding to `ShardIndex`.

### Database Schema per Shard
Each database shard contains the tables:
- `users`: User metadata, credentials, and regional info.
- `footprints`: Calculated footprints (travel, energy, food, waste, calculated carbon output, and timestamp).

---

## 3. Redis Caching & Operations Tier

Redis is integrated as an in-memory database to optimize performance, handle real-time scoring, and protect backend servers.

### A. API Rate Limiting (Sliding Window Algorithm)
To prevent API abuse and DDoS attacks:
- Key format: `rate_limit:{IP_ADDRESS}`.
- Storage: Redis List containing Unix timestamps of recent API requests.
- Logic:
  1. On request, remove timestamps older than the rate limit window (e.g., 60 seconds) using `LTRIM`.
  2. Query list length using `LLEN`.
  3. If length exceeds max allowed limit (e.g., 100 requests/min), reject request with HTTP 429.
  4. Otherwise, push current timestamp to list using `RPUSH` and set TTL of list using `EXPIRE`.

### B. Global Carbon-Reduction Leaderboard (Sorted Sets)
Fetching and sorting scores from multiple sharded databases is extremely slow. We utilize **Redis Sorted Sets (ZSET)**:
- Key: `leaderboard:global`
- Element: `username` or `user_id`
- Score: `carbon_saved_kg` (amount of carbon reduction points accumulated)
- Operations:
  - Add/Update user score: `ZADD leaderboard:global {carbon_saved_kg} {username}`. Runs in $O(\log N)$ time.
  - Fetch Top 10 users: `ZREVRANGE leaderboard:global 0 9 WITHSCORES`. Runs in $O(\log N + M)$ where $M$ is the number of elements requested (10). Extremely fast even with millions of users.

### C. Session & Profile Cache (Cache-Aside Pattern)
- Fetching user profiles:
  - Try fetching from Redis key `user:profile:{user_id}`.
  - On Cache Hit: Return user profile immediately (response time $<2\text{ms}$).
  - On Cache Miss: Query the sharded PostgreSQL database, write results to Redis with a TTL of 1 hour, and return to client.

---

## 4. Security Architecture

1. **Authentication**: Stateless authentication using secure JSON Web Tokens (JWT) signed with a private HMAC-SHA256 key. Tokens expire in 24 hours.
2. **Encryption**: Passwords hashed using `bcrypt` (10 rounds of salt) before storing in SQL shards.
3. **Defense-in-depth Middlewares**:
   - `helmet`: Sets HTTP response headers to secure against Clickjacking, XSS, and MIME sniffing.
   - `cors`: Limits cross-origin access to trusted domains only.
   - `express-validator`: Enforces strict type checking and sanitization on incoming JSON payloads to prevent SQL injection or XSS scripting attacks.

---

## 5. Deployment Blueprint (AWS Cloud)

For production, the Docker services translate directly into AWS-managed components:

1. **Routing**: Route53 handles DNS and forwards traffic to an **Application Load Balancer (ALB)**.
2. **Compute**: Node.js containers run on **AWS ECS Fargate** (Serverless container runtime) with Auto-Scaling enabled based on CPU/Memory thresholds.
3. **Caching**: Redis runs on **AWS ElastiCache (Redis)** configured with Multi-AZ replication and automatic failover.
4. **Storage**: PostgreSQL database shards deploy on **AWS RDS PostgreSQL** (Multi-AZ) or **Aurora Serverless v2** instances, split across private subnets.
5. **Secrets Management**: Credentials and token secrets are retrieved dynamically via **AWS Secrets Manager**.
