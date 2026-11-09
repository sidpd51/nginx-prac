# Nginx learning lab

3 tiny Node backends (`app1..3`) + 1 nginx container. Config is in `nginx/nginx.conf` (heavily commented).

```bash
docker compose up -d --build
docker compose logs -f nginx          # see which upstream served each request
# after editing nginx.conf:
docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload
docker compose down
```

| Port | Concept | Try |
|------|---------|-----|
| 8080 | Reverse proxy -> app1 | `curl localhost:8080` (look at `x_forwarded_for`, `host_header`) |
| 8081 | Round robin | `for i in {1..6}; do curl -s localhost:8081 \| grep served_by; done` |
| 8082 | Weighted (3:1:1) | run 10 requests, `sort \| uniq -c` |
| 8083 | least_conn | `curl localhost:8083/slow &` a few times, then `curl localhost:8083` |
| 8084 | ip_hash (sticky) | repeated requests always hit the same app |
| 8085 | Path routing + failover | `/api/hello` -> app2 (prefix stripped); `docker compose stop app1 app2` -> `/` falls to backup app3 |

Backend endpoints: `/` (JSON with headers seen), `/health`, `/slow` (3s), `/fail` (500).

## Exercises
1. Remove `include proxy_headers.conf` from a block and see the headers vanish from the JSON.
2. Remove the trailing `/` from `proxy_pass http://app2:3000/;` and see how `path` changes.
3. Hit `/fail` on :8085 — `proxy_next_upstream` retries on another server.
4. Add `proxy_cache`, `limit_req`, gzip, or a `return 301` redirect.
5. Add HTTPS with a self-signed cert (`openssl req -x509 ...`) on 8443.
6. Add a `location /static/` serving files with `root`/`alias`.
