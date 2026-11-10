# Nginx Reverse Proxy & Load Balancing: Beginner to Expert

This guide takes you from "what is nginx?" to running a tuned, cached, rate-limited load balancer, using the lab in your `nginx-prac` repo: one nginx container in front of three Express backends. Work through the four levels in order, and do every exercise before reading its solution.

## 0. Lab setup

The lab has four containers: `app1`, `app2`, `app3` (Express servers that tell you who they are) and `nginx`. Nginx publishes ports 8080 to 8085, and each port demonstrates one idea.

```bash
cd nginx-prac
docker compose up -d --build      # build backends, start everything
docker compose ps                 # all 4 containers should be 'running'
curl localhost:8080               # your first proxied request
```

The commands you will use all the time:

| Task | Command |
| --- | --- |
| Watch nginx's access log live | `docker compose logs -f nginx` |
| Check config for mistakes | `docker compose exec nginx nginx -t` |
| Apply config changes without downtime | `docker compose exec nginx nginx -s reload` |
| Stop one backend (simulate a crash) | `docker compose stop app2` |
| Start it again | `docker compose start app2` |
| Tear everything down | `docker compose down` |

The backends answer these URLs, which the exercises rely on:

| URL path | What the backend does |
| --- | --- |
| `/` (anything else) | Returns JSON: `served_by`, `requests_handled`, and the headers nginx forwarded |
| `/health` | Returns `ok` |
| `/slow` | Waits 3 seconds, then answers (simulates a busy server) |
| `/fail` | Returns HTTP 500 (simulates a broken server) |

**Golden workflow:** edit `nginx/nginx.conf`, run `nginx -t`, then `nginx -s reload`, then test with `curl`. Never reload without testing the config first.

**Tip for the exercises:** keep one terminal on `docker compose logs -f nginx`. Each log line shows `upstream=<ip:port>`, which tells you exactly which backend nginx chose.

## Level 1 (Beginner): Reverse proxy basics

A reverse proxy is a server that sits in front of your application and forwards client requests to it. The client talks only to nginx and never learns that backends exist.

### 1.1 Key ideas

- **Client**: a browser or `curl`.
- **Backend (upstream)**: your real application, here an Express server on port 3000.
- **Reverse proxy**: nginx, which accepts the request, passes it to a backend, and returns the answer.
- **Forward proxy** (don't confuse the two): sits in front of *clients* (like a company VPN proxy). A reverse proxy sits in front of *servers*.

Why put nginx in front of Express at all?

1. **One public entry point**: only nginx is exposed; backends stay private.
2. **Load balancing**: spread traffic across several backends (Level 2).
3. **TLS/HTTPS in one place**: backends speak plain HTTP.
4. **Speed**: nginx serves static files, caches, and compresses far more efficiently than Node.
5. **Protection**: rate limits, request size limits, hiding internal details.

The path of one request:

```text
curl  --->  nginx :8080  --->  app1 :3000
      <---              <---
```

### 1.2 Anatomy of nginx.conf

Nginx config is made of **directives** (a name, values, then `;`) and **blocks** (curly braces) that nest. Open `nginx/nginx.conf` and find this skeleton:

```nginx
events {}                      # connection handling; empty = defaults

http {                         # everything about HTTP lives here
  server {                     # one virtual server = one site / one port
    listen 8080;               # which port to accept connections on

    location / {               # rules for URLs starting with /
      proxy_pass http://app1:3000;   # forward to this backend
    }
  }
}
```

Read it as a hierarchy: `http` contains `server`s, and a `server` contains `location`s. A directive set in an outer block is inherited by inner blocks.

### 1.3 Your first reverse proxy

The minimal config is the five lines above. The lab's port 8080 adds four `proxy_set_header` lines. Without them, the backend would see only nginx's address and the wrong `Host`:

```nginx
server {
  listen 8080;
  location / {
    proxy_pass http://app1:3000;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Try it, and notice that `served_by` is always `app1`:

```bash
curl localhost:8080
curl localhost:8080/anything/you/like
```

`$host`, `$remote_addr`, `$scheme` are **variables** that nginx fills in per request. The one you will read most in logs is `$upstream_addr`, the backend that answered.

### 1.4 How `location` picks a rule

When several `location` blocks exist, nginx chooses one by these rules, in order:

| Syntax | Meaning | Priority |
| --- | --- | --- |
| `location = /exact` | Exact match only | 1 (highest) |
| `location ^~ /images/` | Prefix match that stops regex checking | 2 |
| `location ~ \.php$` | Case-sensitive regex (`~*` = case-insensitive) | 3 |
| `location /prefix/` | Plain prefix; the longest one wins | 4 |
| `location /` | Catch-all | lowest |

### 1.5 The trailing-slash trap in `proxy_pass`

This one line causes more beginner bugs than anything else. Port 8085 has `location /api/` with `proxy_pass http://app2:3000/;`.

| `proxy_pass` value | Request `/api/hello` reaches backend as |
| --- | --- |
| `http://app2:3000/` (slash, URI present) | `/hello` (the matched `/api/` is replaced by `/`) |
| `http://app2:3000` (no URI) | `/api/hello` (path passed through unchanged) |

Rule of thumb: if `proxy_pass` has anything after the host:port, even just `/`, nginx replaces the matched location prefix with it.

## Level 1 exercises

After every config edit: `docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload`.

### Exercise 1.1: Read the proxy's answer

Run `curl localhost:8080` and fill in the blanks from the JSON: `served_by` = ?, `host_header` = ?, `x_forwarded_proto` = ?, `x_forwarded_for` = ?. Then run `curl -H 'Host: myshop.local' localhost:8080` and see which field changes and why.

**Solution:** `served_by` is `app1`, `host_header` is `localhost:8080`, `x_forwarded_proto` is `http`, and `x_forwarded_for` is the address of your client as nginx sees it (with Docker on WSL this is often a gateway address such as `172.x.0.1`). With the custom header, `host_header` becomes `myshop.local`, because the config sets `Host $host` and `$host` comes from the request's `Host` header.

### Exercise 1.2: See what headers are for

In the `:8080` server, delete the four `proxy_set_header` lines, reload, and call `curl localhost:8080` again.

**Solution:** `x_real_ip`, `x_forwarded_for` and `x_forwarded_proto` disappear (they show as missing in the JSON), and `host_header` becomes `app1:3000`, because nginx's default for `Host` is the upstream name. The backend can no longer know the real client or the public hostname. Put the lines back afterwards.

### Exercise 1.3: The trailing-slash experiment

On port 8085, call `curl localhost:8085/api/hello` and note the `path` field. Then remove the final `/` from `proxy_pass http://app2:3000/;`, reload, and call it again.

**Solution:** With the slash, `path` is `/hello`. Without it, `path` is `/api/hello`. Restore the slash when done.

### Exercise 1.4: Add your own reverse proxy port

Create a new site on port 8090 that proxies to `app3`. You also have to publish the port in `docker-compose.yml`.

**Solution:**

```nginx
server {
  listen 8090;
  location / {
    proxy_pass http://app3:3000;
    include /etc/nginx/proxy_headers.conf;
  }
}
```

In `docker-compose.yml`, add `- "8090:8090"` under nginx's `ports`, then run `docker compose up -d` (a port change needs the container recreated; a reload is not enough). `curl localhost:8090` should say `served_by: app3`.

### Exercise 1.5: Return your own responses

Nginx can answer by itself, with no backend. On port 8090 add three things: a `/ping` that returns the text `pong`, a `/old` that redirects (301) to `/`, and a `/secret` that returns 403.

**Solution:**

```nginx
location = /ping   { return 200 "pong\n"; }
location = /old    { return 301 /; }
location = /secret { return 403; }
```

Test with `curl -i localhost:8090/ping`, `curl -i localhost:8090/old` (look for `Location: /`) and `curl -i localhost:8090/secret`. The `=` makes each an exact match, so `/ping/extra` still goes to the backend.

### Exercise 1.6: Predict the location

Given these blocks, which one handles each request? Decide first, then check the table in section 1.4.

```nginx
location /          { return 200 "A\n"; }
location /api/      { return 200 "B\n"; }
location = /api/v1  { return 200 "C\n"; }
location ~ \.json$  { return 200 "D\n"; }
```

| Request | Answer | Why |
| --- | --- | --- |
| `/home` | A | Only `/` matches |
| `/api/users` | B | Longest prefix wins |
| `/api/v1` | C | Exact match beats everything |
| `/api/users.json` | D | Prefix B is found, but a matching regex overrides a plain prefix |
| `/data.json` | D | Regex beats the `/` prefix |

## Level 2 (Basic): Load balancing

Load balancing means spreading requests over several identical backends, so no single server is overloaded and one server dying does not take the site down.

### 2.1 The `upstream` block

You name a group of servers with `upstream`, then point `proxy_pass` at the group name instead of a single host:

```nginx
upstream rr_pool {
  server app1:3000;
  server app2:3000;
  server app3:3000;
}

server {
  listen 8081;
  location / { proxy_pass http://rr_pool; }
}
```

The `upstream` block sits in `http`, next to (not inside) `server`. Test it:

```bash
for i in {1..6}; do curl -s localhost:8081 | grep served_by; done
```

You should see `app1, app2, app3, app1, app2, app3`. That is the default method, round robin.

### 2.2 Choosing a method

| Method | Directive | Picks the next server by | Use it when |
| --- | --- | --- | --- |
| Round robin | (default) | Taking turns | Servers are equal and requests cost about the same |
| Weighted | `weight=N` on a server | Turns, proportional to weight | Servers differ in power (a big box and a small box) |
| Least connections | `least_conn;` | Fewest active connections | Request times vary a lot (some slow, some fast) |
| IP hash | `ip_hash;` | Hash of the client IP | The same user must keep hitting the same server |
| Generic hash | `hash $key consistent;` | Hash of any variable (Level 4) | Cache servers, sticky by cookie or URL |

**Weighted example** (lab port 8082). `app1` receives 3 of every 5 requests:

```nginx
upstream weighted_pool {
  server app1:3000 weight=3;
  server app2:3000 weight=1;
  server app3:3000 weight=1;
}
```

**Least connections** (lab port 8083). If `app1` is busy with slow requests, new ones go elsewhere:

```nginx
upstream leastconn_pool {
  least_conn;
  server app1:3000;
  server app2:3000;
  server app3:3000;
}
```

**IP hash** (lab port 8084). The same client address always lands on the same backend, which is a simple form of "sticky sessions":

```nginx
upstream iphash_pool {
  ip_hash;
  server app1:3000;
  server app2:3000;
  server app3:3000;
}
```

Caveat: many users behind one office or mobile-carrier address all hash to the same server, so the spread can be uneven.

### 2.3 Server flags

Each `server` line in an upstream accepts flags:

| Flag | Effect |
| --- | --- |
| `weight=N` | Share of traffic (default 1) |
| `backup` | Used only when all non-backup servers are unavailable |
| `down` | Marked offline by hand; receives nothing (handy for maintenance, and keeps `ip_hash` mapping stable) |
| `max_fails=N fail_timeout=T` | Passive health check, covered in Level 3 |

```nginx
upstream demo {
  server app1:3000;
  server app2:3000 down;     # taken out for maintenance
  server app3:3000 backup;   # spare
}
```

## Level 2 exercises

### Exercise 2.1: Count the distribution

Send 12 requests to port 8081 and count how many each backend served. Then do the same on 8082 with 10 requests. Predict the counts before you run it.

```bash
for i in {1..12}; do curl -s localhost:8081 | grep served_by; done | sort | uniq -c
for i in {1..10}; do curl -s localhost:8082 | grep served_by; done | sort | uniq -c
```

**Solution:** Port 8081 gives 4 / 4 / 4. Port 8082 (weights 3:1:1, total 5) gives `app1` 6, `app2` 2, `app3` 2. Nginx interleaves them rather than sending three in a row, but over a multiple of 5 requests the totals are exact.

### Exercise 2.2: Least connections in action

This shows why `least_conn` beats round robin when some requests are slow. Start two slow requests in the background, then immediately send fast ones:

```bash
curl -s localhost:8083/slow &
curl -s localhost:8083/slow &
for i in {1..3}; do curl -s localhost:8083 | grep served_by; done
```

**Solution:** The two slow requests each occupy a backend for 3 seconds. The fast requests all go to the one idle backend, because it has the fewest active connections. Check the nginx log: you should see the same `upstream=` address for all three. Run the same experiment on port 8081 and the fast requests will be spread across all three, including the two busy servers, which is worse for the user.

### Exercise 2.3: Prove ip\_hash is sticky

Send 6 requests to port 8084 and note the backend. Then stop that backend and send 3 more.

```bash
for i in {1..6}; do curl -s localhost:8084 | grep served_by; done | sort | uniq -c
docker compose stop app2          # replace app2 with the one you saw
for i in {1..3}; do curl -s localhost:8084 | grep served_by; done
docker compose start app2
```

**Solution:** All 6 answers come from one backend. When you stop it, nginx notices the failed connection, retries on another server inside the same request, and your client keeps getting answers, now from a different backend. Note that ip\_hash only looks at the client address, so every `curl` from your machine is "the same user".

### Exercise 2.4: Build a three-tier pool

Add a new upstream and port `8091` with these rules: `app1` is the powerful server and gets 4 of every 6 requests, `app2` gets the other 2 of 6, and `app3` is only a spare used when both others are down.

**Solution:**

```nginx
upstream tiered_pool {
  server app1:3000 weight=4;
  server app2:3000 weight=2;
  server app3:3000 backup;
}
server {
  listen 8091;
  location / { proxy_pass http://tiered_pool; include /etc/nginx/proxy_headers.conf; }
}
```

Publish `8091:8091` in `docker-compose.yml` and run `docker compose up -d`. Verify with 12 requests: 8 for `app1`, 4 for `app2`, none for `app3`. Then `docker compose stop app1 app2` and confirm `app3` now answers.

### Exercise 2.5: Maintenance mode with `down`

You must patch `app2` without users noticing. Mark it `down` in `rr_pool`, reload, and send 6 requests to 8081.

**Solution:** Change the line to `server app2:3000 down;`. After reload, answers alternate between `app1` and `app3` only. You can now stop and update `app2` at leisure; to bring it back, remove `down` and reload again. No client request failed during any step.

### Exercise 2.6: Quick quiz

1. Which method would you choose for 3 identical servers and uniform, fast requests? (*Round robin, the default.*)
2. Your video-export endpoint takes anywhere between 1 and 60 seconds. Which method? (*`least_conn`.*)
3. Your app keeps shopping carts in each server's memory. Which method, and what is the better long-term fix? (*`ip_hash` as a stopgap; the real fix is moving session data into a shared store such as Redis, so any server can serve any user.*)
4. Server A has 8 CPUs and server B has 2. What weights? (*About `weight=4` and `weight=1`.*)

## Level 3 (Intermediate): Resilience and routing

At this level the proxy stops being a simple forwarder. You make it survive backend failures, route by URL or hostname, and control timeouts and logging.

### 3.1 Passing client information correctly

Behind a proxy, the backend's TCP peer is always nginx. Real client details travel in headers that you set (the lab keeps them in `proxy_headers.conf` and `include`s the file everywhere):

| Header | Value set by nginx | Used for |
| --- | --- | --- |
| `Host` | `$host` | Backend builds correct URLs and picks the right site |
| `X-Real-IP` | `$remote_addr` | The one client address nginx saw |
| `X-Forwarded-For` | `$proxy_add_x_forwarded_for` | Chain of addresses: the incoming header (if any) plus the client address |
| `X-Forwarded-Proto` | `$scheme` | Whether the user used `http` or `https` |

**Security note:** any client can send its own `X-Forwarded-For`. Trust it only because *your* nginx appends to it, and have the backend read the **last** entries added by trusted proxies, not blindly the first.

In Express, one line makes `req.ip` and `req.protocol` honour these headers: `app.set('trust proxy', 1)` (the number is how many proxy hops to trust).

### 3.2 Passive health checks: `max_fails` and `fail_timeout`

Open-source nginx does not ping servers on a schedule. It watches real traffic instead:

```nginx
upstream failover_pool {
  server app1:3000 max_fails=2 fail_timeout=10s;
  server app2:3000 max_fails=2 fail_timeout=10s;
  server app3:3000 backup;
}
```

Read it as: if a server fails 2 times within 10 seconds, treat it as unavailable for the next 10 seconds, then try it again. What counts as a "failure" is decided by `proxy_next_upstream` (next section). By default that means connection errors and timeouts, not HTTP 500 replies.

### 3.3 Retrying on another server: `proxy_next_upstream`

```nginx
location / {
  proxy_pass http://failover_pool;
  proxy_next_upstream error timeout http_500 http_502 http_503;
  proxy_next_upstream_tries 2;       # at most 2 servers per request
  proxy_connect_timeout 2s;
}
```

If the chosen backend refuses the connection, times out, or answers with one of the listed status codes, nginx silently tries the next server, and the client just sees a good answer. Two cautions:

- By default nginx will **not** retry `POST`, `PATCH` or `LOCK` requests that were already sent, because retrying could create duplicates (two orders). Add `non_idempotent` only if your API tolerates repeats.
- Retrying every failure can multiply load during an outage. Cap it with `proxy_next_upstream_tries` and `proxy_next_upstream_timeout`.

### 3.4 Timeouts you should know

| Directive | Default | Meaning |
| --- | --- | --- |
| `proxy_connect_timeout` | 60s | Max time to open a connection to the backend |
| `proxy_send_timeout` | 60s | Max gap between two writes of the request to the backend |
| `proxy_read_timeout` | 60s | Max gap between two reads of the response (the one that causes `504`) |
| `client_max_body_size` | 1m | Largest request body accepted; larger gets `413` |

A 3-second `/slow` endpoint is fine by default; set `proxy_read_timeout 2s;` and `/slow` suddenly returns 504 Gateway Timeout. Tune these to what your app really needs.

### 3.5 Routing by path and by hostname

Path-based routing sends different URL prefixes to different backends, for example an API service and a web service. Lab port 8085 already strips `/api/`:

```nginx
location /api/ { proxy_pass http://app2:3000/; }        # /api/x  -> app2 as /x
location /     { proxy_pass http://failover_pool; }     # everything else
```

Hostname-based routing uses `server_name` so one nginx serves several sites on the same port:

```nginx
server { listen 80; server_name shop.example.com;  location / { proxy_pass http://app1:3000; } }
server { listen 80; server_name blog.example.com;  location / { proxy_pass http://app2:3000; } }
```

Test locally without DNS: `curl -H 'Host: blog.example.com' localhost:80`.

### 3.6 Keepalive to the backends

By default nginx opens a new TCP connection to the backend for every request. Reuse connections to cut latency:

```nginx
upstream api_pool {
  server app1:3000;
  server app2:3000;
  keepalive 16;                       # idle connections kept per worker
}
location / {
  proxy_pass http://api_pool;
  proxy_http_version 1.1;             # keepalive needs HTTP/1.1 upstream
  proxy_set_header Connection "";     # remove the default 'close'
}
```

### 3.7 Better logs

The lab already logs the chosen upstream. A production-style format adds timings and the status the *backend* gave:

```nginx
log_format main '$remote_addr [$time_local] "$request" $status '
                'upstream=$upstream_addr up_status=$upstream_status '
                'req_time=$request_time up_time=$upstream_response_time';
access_log /dev/stdout main;
```

When a request was retried, `$upstream_addr` and `$upstream_status` show a comma-separated list, one entry per attempt. That is the fastest way to see failover happening.

## Level 3 exercises

### Exercise 3.1: Watch a failover happen

Keep `docker compose logs -f nginx` open in a second terminal. Then stop `app1` and call port 8085 six times.

```bash
docker compose stop app1
for i in {1..6}; do curl -s -o /dev/null -w '%{http_code}\n' localhost:8085; done
docker compose start app1
```

**Solution:** Every call returns `200`. The first one or two requests that nginx sends to `app1` fail to connect, so nginx retries on `app2` inside the same request (the log shows two addresses in `upstream=`). After 2 failures within 10 seconds, `app1` is skipped entirely, and the log shows a single address again. The users never saw an error. Ten seconds after you restart `app1`, nginx tries it again and it rejoins.

### Exercise 3.2: Total outage and the backup

Stop both `app1` and `app2`, then call 8085 and read `served_by`. Start them again and call it a few more times.

```bash
docker compose stop app1 app2
curl -s localhost:8085 | grep served_by
docker compose start app1 app2
sleep 11; for i in {1..4}; do curl -s localhost:8085 | grep served_by; done
```

**Solution:** With both primary servers failed, the `backup` server `app3` answers. After restart and a 10-second wait (`fail_timeout`), traffic returns to `app1` and `app2` and `app3` goes quiet again. Backups are your safety net, for example a "static maintenance page" server.

### Exercise 3.3: What `/fail` does

Call `curl -i localhost:8085/fail` once, and read the `upstream=` field of the log line.

**Solution:** In this lab every backend returns 500 on `/fail`, so retrying cannot help. The log lists several addresses, one per attempt, and the client still receives a 500 error. This is an important lesson: `proxy_next_upstream` helps with *broken servers*, not with *broken requests*. Because `http_500` is listed, those answers also count toward `max_fails`, so repeated `/fail` calls can mark servers unavailable for 10 seconds, and a normal request in that window may see a brief `502`. Wait 10 seconds and it recovers.

### Exercise 3.4: Provoke a 504

On a new server block (port 8092) proxy to `app1` with `proxy_read_timeout 2s;`, then request `/slow` (which takes 3 seconds).

**Solution:**

```nginx
server {
  listen 8092;
  location / {
    proxy_pass http://app1:3000;
    proxy_read_timeout 2s;
  }
}
```

`curl -i localhost:8092/slow` returns `504 Gateway Timeout` after about 2 seconds, while `curl -i localhost:8092/` is fine. Remember to publish port 8092 in Compose. Raise the timeout to `5s`, reload, and `/slow` succeeds after about 3 seconds.

### Exercise 3.5: Two sites on one port

Using `server_name`, make port 8093 serve `app1` for host `shop.local` and `app2` for host `blog.local`. Prove it with `curl` only.

**Solution:**

```nginx
server { listen 8093; server_name shop.local; location / { proxy_pass http://app1:3000; } }
server { listen 8093; server_name blog.local; location / { proxy_pass http://app2:3000; } }
```

```bash
curl -s -H 'Host: shop.local' localhost:8093 | grep served_by   # app1
curl -s -H 'Host: blog.local' localhost:8093 | grep served_by   # app2
curl -s -H 'Host: other.local' localhost:8093 | grep served_by  # app1 (first server = default)
```

The last line shows the *default server* rule: the first `server` for a port handles unknown hosts. Add `default_server` to `listen` to choose explicitly, or use `return 444;` there to drop unknown hosts.

### Exercise 3.6: Custom log format

Change the access log so each line contains the client IP, the request, the final status, the upstream address and the backend's response time, then compare a normal request and a `/slow` request.

**Solution:** Use the `main` format from section 3.7. For `/` you should see `up_time` near `0.00x`; for `/slow` it is about `3.00x`. Your own log line is the evidence that nginx, not the backend, was the one to see the time.

### Exercise 3.7: Route three ways

On port 8094, build this routing table in one `server` block:

| Request | Goes to |
| --- | --- |
| `/api/...` | `app2`, with `/api` removed |
| `/admin/...` | `app3`, path unchanged |
| `/health` | answered by nginx itself with `ok`, never reaching a backend |
| everything else | `rr_pool` |

**Solution:**

```nginx
server {
  listen 8094;
  location /api/   { proxy_pass http://app2:3000/;  include /etc/nginx/proxy_headers.conf; }
  location /admin/ { proxy_pass http://app3:3000;   include /etc/nginx/proxy_headers.conf; }
  location = /health { return 200 "ok\n"; }
  location /       { proxy_pass http://rr_pool;     include /etc/nginx/proxy_headers.conf; }
}
```

Verify: `/api/x` gives `path: /x` from `app2`; `/admin/x` gives `path: /admin/x` from `app3`; `/health` produces no new `upstream=` entry in the log (it shows `upstream=-`).

## Level 4 (Expert): Performance, security and operations

Expert work is less about new syntax and more about knowing which knob to turn, and what breaks when you turn it. Each topic below is a self-contained building block.

### 4.1 Response caching

Nginx can store backend answers and serve repeats without touching the backend at all.

```nginx
http {
  proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=api_cache:10m
                   max_size=100m inactive=10m use_temp_path=off;

  server {
    listen 8095;
    location / {
      proxy_pass http://rr_pool;
      proxy_cache api_cache;
      proxy_cache_valid 200 30s;               # cache good answers for 30 s
      proxy_cache_lock on;                     # one request fills the cache; others wait
      proxy_cache_use_stale error timeout updating http_500 http_502 http_503;
      add_header X-Cache-Status $upstream_cache_status;   # MISS, HIT, STALE...
    }
  }
}
```

- `keys_zone=api_cache:10m` is shared memory for cache keys (about 8,000 keys per MB).
- `proxy_cache_use_stale` serves an old copy when the backend is down: the site stays up during an outage.
- Never cache personalised responses. By default nginx skips caching when the backend sends `Set-Cookie` or `Cache-Control: private`; use `proxy_cache_bypass` and `proxy_no_cache` with a cookie or header variable to opt out explicitly.

### 4.2 Rate limiting and connection limits

```nginx
http {
  limit_req_zone  $binary_remote_addr zone=perip:10m rate=5r/s;
  limit_conn_zone $binary_remote_addr zone=conns:10m;

  server {
    listen 8096;
    location / {
      limit_req  zone=perip burst=10 nodelay;   # 5 req/s, allow bursts of 10
      limit_conn conns 20;                      # max 20 concurrent per IP
      limit_req_status 429;                     # 'Too Many Requests' instead of 503
      proxy_pass http://rr_pool;
    }
  }
}
```

How to read `rate=5r/s burst=10 nodelay`: each client gets 5 requests per second steadily, plus a bucket of 10 extra requests it may spend instantly. Beyond that, requests are rejected. Without `nodelay`, excess requests are queued and slowed down instead. Stricter limits belong on sensitive paths such as `/login`, which is just another `location` with its own zone.

### 4.3 TLS (HTTPS) termination

Nginx handles encryption with the browser, and talks plain HTTP to the backends. Create a self-signed certificate for the lab:

```bash
mkdir -p nginx/certs
openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -keyout nginx/certs/server.key -out nginx/certs/server.crt \
  -subj "/CN=localhost"
```

Mount `./nginx/certs:/etc/nginx/certs:ro` in `docker-compose.yml`, publish `8443:8443`, then:

```nginx
server {
  listen 8443 ssl;
  http2 on;
  ssl_certificate     /etc/nginx/certs/server.crt;
  ssl_certificate_key /etc/nginx/certs/server.key;
  ssl_protocols       TLSv1.2 TLSv1.3;

  location / {
    proxy_pass http://rr_pool;
    include /etc/nginx/proxy_headers.conf;    # X-Forwarded-Proto will now say https
  }
}
```

Test with `curl -k https://localhost:8443` (`-k` accepts the self-signed certificate). In production you would use real certificates (for example from Let's Encrypt) and add a port-80 server that does `return 301 https://$host$request_uri;`.

### 4.4 Advanced balancing

| Goal | Configuration | Notes |
| --- | --- | --- |
| Stick by user or cookie | `hash $cookie_session consistent;` | Same value always maps to the same server. `consistent` (ketama hashing) moves only a small share of keys when a server is added or removed |
| Stick by URL (cache servers) | `hash $request_uri consistent;` | Each URL lives on one cache node, so the caches do not duplicate each other |
| Avoid herd behaviour at scale | `random two least_conn;` | Picks two servers at random, then the one with fewer connections; scales well across many nginx instances |
| Per-server connection cap | `server app1:3000 max_conns=100;` | Excess goes to other servers`; if every server is at its cap, the client gets an error` |

Plain `hash $key;` (without `consistent`) reshuffles almost every key when the server list changes, which is the usual cause of "everyone lost their session after a deploy".

Open-source nginx also has **no active health checks**, no `sticky cookie` directive, no `slow_start`, and no `least_time`. Those belong to the commercial NGINX Plus. With the open-source version, stay with passive checks and pair nginx with an orchestrator (Kubernetes, Docker Swarm) that restarts unhealthy containers.

### 4.5 WebSockets, streaming and buffering

WebSockets upgrade an HTTP connection, and nginx must be told to pass the upgrade through:

```nginx
map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      close;
}

location /ws/ {
  proxy_pass http://rr_pool;
  proxy_http_version 1.1;
  proxy_set_header Upgrade    $http_upgrade;
  proxy_set_header Connection $connection_upgrade;
  proxy_read_timeout 1h;           # idle sockets would be cut after 60 s otherwise
}
```

By default nginx **buffers** the backend's response and sends it to the client when ready, which frees the backend quickly from slow clients. For Server-Sent Events or live streaming, buffering delays the data, so turn it off on that `location` with `proxy_buffering off;`. For large uploads, `proxy_request_buffering off;` streams the body to the backend instead of storing it first.

### 4.6 Operating nginx safely

- **Zero-downtime changes:** `nginx -t` then `nginx -s reload`. Nginx starts new workers with the new config and lets old workers finish their in-flight requests. Set `worker_shutdown_timeout 30s;` so a stuck connection cannot keep old workers alive forever.
- **DNS is resolved at startup:** hostnames in an `upstream` block are looked up once, when nginx loads the config. If a backend's IP changes (containers recreated), reload nginx. To re-resolve at runtime, use a variable: `set $backend http://app1:3000; proxy_pass $backend;` together with `resolver 127.0.0.11 valid=10s;` (as the lab's `resolver` line allows).
- **Rolling deploy of backends:** mark one server `down`, reload, deploy, remove `down`, reload, then the next. No request fails if you do it in order.
- **Tune workers:** `worker_processes auto;` (one per CPU core) and `worker_connections 1024;` inside `events {}` are good starting points.
- **Debug:** `nginx -T` prints the full effective configuration; `error_log /dev/stderr debug;` is very noisy but explains every decision (use briefly).

### 4.7 Security hardening checklist

| Setting | Why |
| --- | --- |
| `server_tokens off;` | Hide the nginx version from headers and error pages |
| `client_max_body_size 5m;` | Reject oversized uploads early (default 1m) |
| `client_body_timeout`, `client_header_timeout` | Defend against slow-loris clients |
| `limit_req` / `limit_conn` | Blunt brute-force and flooding |
| `proxy_hide_header X-Powered-By;` | Express adds this header; there is no reason to show it |
| `add_header X-Content-Type-Options nosniff always;` | Basic browser protections; add `Strict-Transport-Security` once HTTPS works |
| `location ~ /\. { deny all; }` | Block dotfiles such as `.git` or `.env` if you serve files |
| `allow 10.0.0.0/8; deny all;` | Restrict admin or metrics paths by network |
| Backends not published | In Compose, only nginx has `ports`; the Express containers are reachable only through the proxy |

## Level 4 exercises and capstone

### Exercise 4.1: Prove the cache works

Add the caching server from section 4.1 (port 8095, published in Compose). The backend's JSON contains a `requests_handled` counter, which makes hits easy to spot.

```bash
for i in {1..4}; do curl -si localhost:8095 | grep -E 'X-Cache-Status|requests_handled'; done
sleep 31
curl -si localhost:8095 | grep -E 'X-Cache-Status|requests_handled'
```

**Solution:** The first call shows `MISS`. The next three show `HIT` and the *same* `requests_handled` value, because they never reached a backend (and the log shows `upstream=-`). After the 30-second validity ends you get `EXPIRED` and a new counter value. Now stop all backends and request again within a few minutes: with `proxy_cache_use_stale` the cached copy is served with `STALE`.

### Exercise 4.2: Trip the rate limiter

Use the 4.2 server (port 8096). Send 30 requests as fast as possible and count the status codes.

```bash
for i in {1..30}; do curl -s -o /dev/null -w '%{http_code}\n' localhost:8096; done | sort | uniq -c
```

**Solution:** Roughly the first 11 requests succeed (1 allowed plus a burst of 10) and the remainder return `429`; a few more may pass because the bucket refills at 5 per second while the loop runs. Exact numbers vary with your machine's speed. Try `burst=0` to see rejections start on request 2, and remove `nodelay` to see requests get slowed instead of rejected.

### Exercise 4.3: HTTPS in front of the pool

Implement section 4.3 end to end. Then show that the backend knows the user came over HTTPS.

**Solution:** `curl -sk https://localhost:8443 | grep x_forwarded_proto` returns `"https"`, while plain-HTTP ports return `"http"`. Add `curl -kv https://localhost:8443 2>&1 | grep -i 'TLS\|subject'` to see the negotiated protocol (TLS 1.3 here). Bonus: add `http://localhost:8097` that redirects everything to the HTTPS port with `return 301 https://localhost:8443$request_uri;`.

### Exercise 4.4: Session stickiness by header

Make a pool that keeps each user on one backend based on an `X-User` request header, and survives adding a fourth server with minimal reshuffling.

**Solution:**

```nginx
upstream user_pool {
  hash $http_x_user consistent;
  server app1:3000;
  server app2:3000;
  server app3:3000;
}
server {
  listen 8098;
  location / { proxy_pass http://user_pool; include /etc/nginx/proxy_headers.conf; }
}
```

```bash
for u in alice bob carol dave erin; do
  echo -n "$u: "; for i in 1 2 3; do curl -s -H "X-User: $u" localhost:8098 | grep -o 'app[0-9]'; done | sort -u | tr '\n' ' '; echo
done
```

Each user prints exactly one backend. Different users spread across servers. Repeat after marking `app3` as `down`: users who were on `app1` or `app2` stay where they were, and only `app3`'s users move. With plain `hash` (no `consistent`), many more users would move.

### Exercise 4.5: Break and fix

Each config below has a bug. Find it before reading the answer.

```nginx
# A: requests to /api/users return 404 from the backend, which expects /users
location /api/ { proxy_pass http://app2:3000; }

# B: the backend generates http:// links although users use https
location / { proxy_pass http://app1:3000; }

# C: nginx -t fails
upstream pool { server app1:3000 server app2:3000; }

# D: a 20 MB upload returns 413
location /upload { proxy_pass http://app1:3000; }

# E: WebSocket connections drop after exactly 60 seconds of silence
location /ws/ { proxy_pass http://app1:3000; proxy_http_version 1.1;
                proxy_set_header Upgrade $http_upgrade;
                proxy_set_header Connection "upgrade"; }
```

| Config | Bug | Fix |
| --- | --- | --- |
| A | No URI on `proxy_pass`, so `/api/` is not stripped | `proxy_pass http://app2:3000/;` |
| B | `X-Forwarded-Proto` is never sent | `proxy_set_header X-Forwarded-Proto $scheme;` and `app.set('trust proxy', 1)` in Express |
| C | Missing `;` after the first `server` line | `server app1:3000; server app2:3000;` |
| D | `client_max_body_size` is 1m by default | `client_max_body_size 25m;` in that location |
| E | `proxy_read_timeout` defaults to 60 s | `proxy_read_timeout 1h;` (and ideally send WebSocket pings) |

### Capstone project: a production-style gateway

Bring everything together. Build one nginx `server` on port 8443 (HTTPS) that behaves as follows, then write a short `curl` test script that proves every line.

| Requirement | Hints |
| --- | --- |
| HTTPS with a self-signed certificate; plain-HTTP port redirects to it | 4.3 |
| `/api/` goes to a pool of `app1` and `app2` (least connections, passive health checks, retries on error), prefix stripped | 2.2, 3.2, 3.3, 1.5 |
| `/api/` is rate limited to 5 requests per second per client, returning 429 | 4.2 |
| `/api/` GET answers are cached for 10 seconds, and an `X-Cache-Status` header is shown | 4.1 |
| `/admin/` goes to `app3` only | 3.5 |
| `/health` is answered by nginx directly | 1.6 |
| `app3` acts as backup for the API pool | 2.3 |
| Logs include the upstream address, upstream status and timings | 3.7 |
| `server_tokens off;` and a 5 MB body limit | 4.7 |

**Reference solution (skeleton).** Put the shared parts in `http {}`, then:

```nginx
http {
  server_tokens off;
  log_format main '$remote_addr "$request" $status upstream=$upstream_addr '
                  'up_status=$upstream_status rt=$request_time urt=$upstream_response_time';
  access_log /dev/stdout main;
  resolver 127.0.0.11 valid=10s;

  limit_req_zone $binary_remote_addr zone=api_rl:10m rate=5r/s;
  proxy_cache_path /var/cache/nginx keys_zone=api_cache:10m max_size=100m inactive=10m;

  upstream api_pool {
    least_conn;
    server app1:3000 max_fails=2 fail_timeout=10s;
    server app2:3000 max_fails=2 fail_timeout=10s;
    server app3:3000 backup;
  }

  server {                                   # HTTP -> HTTPS
    listen 8097;
    return 301 https://localhost:8443$request_uri;
  }

  server {
    listen 8443 ssl;
    http2 on;
    ssl_certificate     /etc/nginx/certs/server.crt;
    ssl_certificate_key /etc/nginx/certs/server.key;
    client_max_body_size 5m;

    location = /health { return 200 "ok\n"; }

    location /api/ {
      limit_req zone=api_rl burst=10 nodelay;
      limit_req_status 429;

      proxy_cache api_cache;
      proxy_cache_valid 200 10s;
      add_header X-Cache-Status $upstream_cache_status;

      proxy_pass http://api_pool/;
      proxy_next_upstream error timeout http_502 http_503;
      proxy_next_upstream_tries 2;
      include /etc/nginx/proxy_headers.conf;
    }

    location /admin/ {
      proxy_pass http://app3:3000;
      include /etc/nginx/proxy_headers.conf;
    }
  }
}
```

Note what the solution deliberately avoids: `http_500` in `proxy_next_upstream` (so a buggy request does not mark healthy servers as failed) and caching only successful `200` answers. These are judgement calls, and being able to explain them is what separates an expert from someone who copied a config.

## Troubleshooting and cheat sheet

### Common errors

| Symptom | Usual cause | What to check |
| --- | --- | --- |
| `502 Bad Gateway` | Backend is down, refused the connection, or all servers are marked failed | `docker compose ps`; `upstream=` in the log; `docker compose logs app1` |
| `504 Gateway Timeout` | Backend took longer than `proxy_read_timeout` | Slow endpoint; raise the timeout or fix the backend |
| `404` from the backend with a wrong `path` | Trailing slash on `proxy_pass` | Section 1.5 |
| `413 Request Entity Too Large` | Body above `client_max_body_size` | Raise it for that location |
| `nginx: [emerg] host not found in upstream` | Name not resolvable at startup (container not up yet) | Start order; `depends_on`; DNS name spelling |
| Edits seem ignored | Forgot to reload, or container uses an old mounted file | `nginx -t`, `nginx -s reload`, `nginx -T` to see the loaded config |
| New port refuses connection | Port not published in Compose | Add it under `ports`, then `docker compose up -d` |
| Wrong `location` answers | Match-priority rules | Section 1.4; test with `curl -i` |

A reliable debugging routine: **(1)** `nginx -t`; **(2)** `curl -i` the exact URL; **(3)** read the nginx log line and its `upstream=`; **(4)** `curl` the backend directly from inside the network, e.g. `docker compose exec nginx wget -qO- http://app1:3000/health`; **(5)** change one thing, reload, repeat.

### Directive cheat sheet

| Directive | Context | Purpose |
| --- | --- | --- |
| `listen`, `server_name` | server | Port and hostname this site answers |
| `location` | server | URL matching rules |
| `proxy_pass` | location | Forward to a backend or upstream |
| `proxy_set_header` | http, server, location | Set headers sent to the backend |
| `upstream` | http | Named group of backend servers |
| `weight`, `backup`, `down`, `max_fails`, `fail_timeout`, `max_conns` | server (in upstream) | Per-server behaviour |
| `least_conn`, `ip_hash`, `hash`, `random` | upstream | Balancing method |
| `keepalive` | upstream | Reuse backend connections |
| `proxy_next_upstream`, `proxy_next_upstream_tries` | http, server, location | Retry rules |
| `proxy_connect_timeout`, `proxy_send_timeout`, `proxy_read_timeout` | http, server, location | Timeouts |
| `proxy_cache_path`, `proxy_cache`, `proxy_cache_valid` | http / location | Response caching |
| `limit_req_zone`, `limit_req`, `limit_conn` | http / location | Rate and connection limits |
| `ssl_certificate`, `ssl_certificate_key`, `ssl_protocols` | server | HTTPS |
| `return`, `rewrite` | server, location | Redirects and fixed replies |
| `log_format`, `access_log`, `error_log` | http, server | Logging |

### Command cheat sheet

| Command | Meaning |
| --- | --- |
| `nginx -t` | Test configuration syntax |
| `nginx -T` | Test and dump the full configuration |
| `nginx -s reload` | Graceful config reload |
| `nginx -s quit` | Graceful shutdown (finish current requests) |
| `curl -i URL` | Show response headers and status |
| `curl -H 'Host: x' URL` | Fake a hostname |
| `curl -w '%{http_code} %{time_total}\n' -o /dev/null -s URL` | Status code and timing only |

### Where to go next

1. Rebuild the lab on a real Linux VM with nginx installed from packages, so you meet `/etc/nginx/conf.d/`, `sites-enabled` and `systemd`.
2. Get a real certificate with Let's Encrypt (`certbot`) for a domain you own.
3. Read the official docs for [`ngx_http_upstream_module`](https://nginx.org/en/docs/http/ngx_http_upstream_module.html) and [`ngx_http_proxy_module`](https://nginx.org/en/docs/http/ngx_http_proxy_module.html), which list every directive used here.
4. Learn how the same ideas appear in other tools: Kubernetes Ingress, HAProxy, Traefik, and cloud load balancers.
5. Load test your setup with a tool such as `ab`, `wrk` or `hey`, and watch what the log and the backends do.
