# 무명 거래소 — VM 자체 DB (Stand-alone PostgreSQL + PostgREST)

Supabase 이그레스 초과로 VM 자체 DB 로 이관하기 위한 산출물 모음.

## 구성

- **PostgreSQL 16** (Docker, 볼륨 영속)
- **PostgREST 12** — Supabase SDK 호환 REST API
- **Adminer 4** (관리 UI, SSH 터널 전용)

> Supabase Self-Host 전체 스택(GoTrue/Realtime/Postgres 메타)이 아닌, **Postgres + PostgREST** 만 올립니다.
> Auth(Google OAuth), Realtime 은 임시 비활성 — 이후 자체 JWT / WebSocket 폴링 으로 단계 복구.

## VM 요구사항
- Ubuntu 22.04+
- 2 vCPU / 4 GB RAM / 20 GB Disk (이상)
- 열려 있어야 할 포트: 22 (SSH), 3001 (PostgREST).
- 닫힌 채 유지: 5432 (DB), 8080 (Adminer) — 로컬 / SSH 터널 만.

## 디렉토리 구조

```
vm-db/
├── setup.sh                      # VM 에서 최초 1회 실행
├── docker-compose.yml
├── .env.example                  # 프론트 / 엔진 연결 정보 예시
└── sql/
    ├── init/                     # docker-entrypoint-initdb.d 자동 실행 (처음 1회)
    │   ├── 01_schema.sql         # 스키마 (Supabase 호환 함수 포함)
    │   └── 02_seed_sample.sql    # 최소 시드 데이터
    └── runtime/                  # 운영 중 수동 실행용 SQL
```

## 1. 설치 (VM 에서 1회 실행)

```bash
# 1) 프로젝트 폴더 업로드 (git clone 또는 scp)
scp -r vm-db user@VM_IP:~/

# 2) VM 에 SSH 접속 후
cd ~/vm-db
chmod +x setup.sh
./setup.sh
```

`setup.sh` 이 할 일:
1. Docker / Compose plugin 설치 (apt)
2. ufw 방화벽 — 22 및 3001 만 개방
3. 자동 `.env` 생성 (POSTGRES_PASSWORD, PGRST_JWT_SECRET 랜덤)
4. `docker compose up -d` 로 Postgres + PostgREST + Adminer 컨테이너 시작
5. **anon / service_role JWT 발급** (PostgREST v12 형식)
6. `connection.txt` 파일에 모든 접속 정보 기록

## 2. 클라이언트 연결

`connection.txt` 의 값을 로컬 PC 의 `.env.local` (프론트) 및 `engine-server/.env` (백엔드) 에 반영:

```env
NEXT_PUBLIC_SUPABASE_URL=http://VM_IP:3001
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...        # anon JWT
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...           # service_role JWT (백엔드만)
```

## 3. 알려진 제약 (PostgREST 전환 1차)

| 기능                | 상태       | 대응                                              |
|---------------------|------------|---------------------------------------------------|
| 데이터 CRUD          | 정상       | PostgREST 가 Supabase SDK REST 와 호환             |
| RLS                  | 해제       | 모든 policy `USING(true)` — VM 방화벽/PostgREST 인가에 의찄 |
| Google OAuth / Login | 미작동     | GoTruth 없음. 자체 auth.users 직접 INSERT (admin 1명만 시드됨) |
| Realtime             | 미작동     | PostgREST-Postgres 단독엔 부재. 폴링 fallback 적용 필요 |
| Storage              | 미작동     | (현재 미사용이라 영향 없음)                          |

## 4. 다음 단계 (선택)

- **Auth 재도입**: 자체 JWT 발급 미니 서비스 (~80 줄 Node.js) 추가 → PostgREST 의 `request.jwt.claim.sub` 로 `auth.uid()` 가 작동, RLS 재활성화.
- **Realtime 재도입**: 
  - 옵션 A) Supabase Self-Host 의 Realtime 만 추가 (Elixir 서비스)
  - 옵션 B) 엔진의 tick 후 SSE 등으로 클라이언트 푸시 (~50 줄 Express)
- **백업 자동화**: `pg_dump` cron + S3/compressed每日 업로드 스크립트

## 5. 운영

```bash
# 서비스 재시작
sudo docker compose restart

# DB 컨테이너 진입 (psql)
sudo docker compose exec db psql -U moo_app -d moo

# 로그 보기
sudo docker compose logs -f rest
sudo docker compose logs -f db

# 백업
sudo docker compose exec db pg_dump -U moo_app moo > backup_$(date +%F).sql

# 복구
cat backup_YYYY-MM-DD.sql | sudo docker compose exec -T db psql -U moo_app -d moo
```

## 6. egress 절감 효과

- 자체 DB=True → 월 5 GB egress 한도 없음 (VM 의 outbound 트래픽 한도는 CSP 정책에 따라 별도)
- 1 차 릴리스 는 RLS 해제 상태 이나, VM 내부 네트워크 보안 그룹 + PostgREST 포트 3001 만 노출 로 외부 공격 최소화