# WODSiege 소규모 파일럿 배포

이 문서는 PC를 계속 켜 두지 않고 단일 Linux 서버에서 WODSiege 파일럿 API를 HTTPS로 운영하기 위한 최소 배포 키트다. Caddy만 80/443 포트를 공개하고 Node API와 SQLite는 Docker 내부 네트워크 및 named volume에 둔다. 이는 제한된 파일럿의 출발점이지, 개인정보보호 법률 검토·침투 테스트·고가용성·스토어 출시를 포함한 프로덕션 인증이 아니다.

## 구조와 안전 기본값

```text
Android release 앱 ── HTTPS :443 ── Caddy ── private network ── Node :8787
                                                        └────── named volume
```

- API 컨테이너는 외부 포트를 publish하지 않고 비-root `node` 사용자, read-only root filesystem, 모든 Linux capability 제거로 실행한다.
- Caddy만 80/443 TCP와 443 UDP를 publish한다. 인증서·SQLite·업로드는 각각 named volume에 남는다.
- 운영자 이메일/비밀번호는 Compose secret 파일로만 API에 전달한다. 비밀번호를 `.env`, Compose YAML, 이미지, 명령행 인자에 넣지 않는다.
- production 모드는 HTTPS public origin, 절대 데이터 경로, proxy에서 접근 가능한 bind host, 운영자 secret 파일이 없으면 시작을 거부한다. CORS wildcard와 HTTP origin도 거부한다.
- Capacitor release WebView origin `https://localhost`는 기본 허용된다. 추가 관리 웹 origin은 정확한 HTTPS origin만 쉼표로 등록한다.
- Origin 헤더가 있으면서 allowlist에 없는 preflight와 실제 요청은 데이터 변경 전에 403으로 거부한다. Origin이 없는 서버간 요청은 CORS가 인증 수단이 아니므로 허용되며, 보호 API에는 bearer 인증이 별도로 적용된다.
- 요청 access log는 기본으로 켜지 않았다. 애플리케이션 오류 로그에도 요청 본문, Authorization 헤더, 비밀번호 또는 토큰을 기록하지 않는다.

Caddy는 hostname이 설정되고 DNS와 외부 80/443 조건이 충족되면 인증서를 자동 발급·갱신하고 HTTP를 HTTPS로 전환한다. 공식 요구 조건은 [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https)와 [HTTPS quick-start](https://caddyserver.com/docs/quick-starts/https)를 확인한다. Secret을 환경변수 대신 `/run/secrets/...` 파일로 제한한 이유는 [Docker Compose secrets 안내](https://docs.docker.com/compose/how-tos/use-secrets/)에 설명되어 있다. Compose는 확인 당시 [공식 Caddy image 계열](https://github.com/caddyserver/caddy-docker)의 명시적 patch tag를 사용한다.

## 사전 준비

다음 항목은 운영자가 직접 준비해야 한다. 이 저장소의 명령은 DNS, 인증서, 유료 서버, 방화벽 또는 앱 서명을 대신 변경하지 않는다.

1. 보안 업데이트가 적용되는 Linux 서버와 고정 public IP를 준비한다.
2. 본인이 관리하는 도메인의 A/AAAA 레코드를 그 서버로 지정한다.
3. 서버 방화벽과 필요 시 공유기에서 80/TCP, 443/TCP, 443/UDP만 연다. 8787과 데이터베이스 파일은 외부에 열지 않는다.
4. Docker Engine과 Docker Compose v2 plugin을 공식 설치 절차로 설치한다.
5. 서버 시간 동기화, 디스크 암호화, 관리자 SSH key, 자동 보안 업데이트를 설정한다.

## 환경과 secret 준비

루트의 `.env.example`은 형식만 보여 주는 placeholder다. 채운 파일과 secret 파일은 저장소 밖의 운영 전용 디렉터리에 두고 권한을 제한한다. 아래 이름은 예시이며 실제 디렉터리 정책에 맞춰 변경한다.

```bash
sudo install -d -m 0700 /etc/wodsiege
sudoedit /etc/wodsiege/compose.env
sudoedit /etc/wodsiege/operator-email.txt
sudoedit /etc/wodsiege/operator-password.txt
sudo chmod 0600 /etc/wodsiege/compose.env
sudo chown 1000:1000 /etc/wodsiege/operator-*.txt
sudo chmod 0400 /etc/wodsiege/operator-*.txt
```

`compose.env`에는 `.env.example`의 키를 복사해 실제 도메인과 **절대 secret 파일 경로**를 넣는다. `WODSIEGE_SITE_ADDRESS`와 `WODSIEGE_PUBLIC_ORIGIN`은 같은 `https://` origin이어야 한다. 운영자 비밀번호는 10자 이상이어야 하며 재사용하지 않는다. secret 파일은 한 줄만 포함해야 한다. API 이미지의 `node` 사용자는 UID/GID 1000이므로 로컬 Compose의 file-backed secret을 읽을 수 있게 위처럼 secret 소유자를 1000으로 지정한다. 서버에서 UID 1000을 다른 계정이 사용한다면 접근 충돌을 먼저 해소하고, secret을 0644처럼 전체 공개해서 우회하지 않는다.

`example.com` 계열, localhost, special-use domain 또는 IP 주소를 production public origin에 남기면 API가 시작을 거부한다. placeholder를 그대로 실행해 인증서 준비가 된 것처럼 보이지 않게 하기 위한 guard다.

운영자 secret은 최초 계정 생성용 bootstrap이다. 같은 이메일의 운영자가 이미 있으면 서버 재시작 시 파일의 새 비밀번호로 덮어쓰지 않는다. 따라서 secret 파일 교체와 컨테이너 재시작을 비밀번호 rotation으로 간주하면 안 된다. [운영자 비밀번호 오프라인 변경](OPERATOR-PASSWORD.md)의 `operator:rotate`와 백업·재로그인 검증 절차를 사용한다. 현재 도구는 호스트 경로용이며 API 이미지에 포함되지 않는다. named volume 접근·권한·복구 리허설이 준비되지 않았다면 계정 유출 의심 상태에서 서버를 다시 공개하지 않는다.

추가 브라우저 관리 origin이 없으면 `WODSIEGE_ALLOWED_ORIGINS=`로 비워 둔다. Android 앱 origin은 서버가 자체 추가하므로 여기에 넣을 필요가 없다. wildcard, 경로(`/api`), query, fragment, 사용자 정보가 있는 URL은 허용되지 않는다.

설정 렌더링은 컨테이너를 시작하지 않고 먼저 확인한다.

```bash
docker compose --env-file /etc/wodsiege/compose.env \
  -f deploy/compose.yaml config --quiet
```

출력 전체를 공유하지 않는다. 렌더링된 설정에는 이메일과 host secret 파일 경로 같은 운영 정보가 포함될 수 있다.

## 시작과 확인

DNS가 현재 서버를 가리키고 80/443이 도달 가능한 상태에서 실행한다.

```bash
docker compose --env-file /etc/wodsiege/compose.env \
  -f deploy/compose.yaml up -d --build
docker compose --env-file /etc/wodsiege/compose.env \
  -f deploy/compose.yaml ps
curl --fail --silent --show-error https://pilot.example.com/api/health
```

마지막 URL은 실제 도메인으로 바꾼다. 정상 응답은 `{"ok":true,"mode":"pilot"}`다. 이 endpoint는 프로세스 liveness만 나타내며 SQLite 쓰기나 영상 volume 용량·권한을 증명하지 않는다. 브라우저에서 인증서 hostname과 유효기간을 확인하고, 외부 네트워크의 Android release 앱에서 서버 주소를 같은 HTTPS origin으로 설정해 로그인·작은 영상 업로드·재생을 확인한다. debug APK의 `adb reverse` 성공은 실제 HTTPS 검증을 대체하지 않는다.

API를 단독으로 public port에 실행하지 않는다. production의 `trust proxy=1`은 Compose에서 Caddy가 유일한 한 홉이고 API가 publish되지 않는다는 전제 아래 실제 client IP별 로그인 제한을 적용한다.

## 운영 점검

매 배포와 정기 점검 때 다음을 확인한다.

- `docker compose ... ps`에서 API liveness health가 healthy이고 Caddy가 재시작 반복 중이 아닌지 확인한다.
- `curl https://<domain>/api/health`가 HTTPS redirect 이후 200인지 확인한다.
- 별도 시험 계정의 등록/로그인과 작은 영상 업로드·조회로 DB 및 upload volume의 쓰기/읽기를 검증한다. 실제 참가자 자료를 probe로 사용하지 않는다.
- 인증서 갱신 오류, 디스크 여유, named volume 크기, 호스트 보안 업데이트를 확인한다.
- 로그를 외부에 전달한다면 접근 권한과 보존 기간을 제한하고, Authorization/header/body 로깅을 추가하지 않는다.
- Caddy와 Node base image 업데이트는 staging에서 재빌드·health/API/실기기 검증 후 반영한다. floating `latest` tag를 사용하지 않는다.

종료는 graceful shutdown을 사용한다. API는 새 연결을 닫고 최대 10초 뒤 남은 연결을 종료한 후 SQLite를 닫는다.

```bash
docker compose --env-file /etc/wodsiege/compose.env \
  -f deploy/compose.yaml stop
```

## 백업과 복구 연습

`wodsiege_data`에는 SQLite DB, 비밀번호 hash, 활성 세션, 위치 확인 자료와 비공개 영상이 함께 있다. 백업도 같은 수준의 개인정보로 취급해 암호화하고 접근자를 제한하며 별도 시스템에 보관한다. WAL 파일까지 일관되게 확보하도록 백업 전 API를 멈춘다.

백업 형식, dry-run, checksum 검증, 새 경로 복원 및 세션 무효화 절차는 [SQLite·증빙 영상 오프라인 백업/복구](BACKUP-RESTORE.md)를 따른다. 해당 도구는 host 경로용이므로 Docker named volume에 적용할 때는 격리된 시험 volume에서 source/target mount, UID 1000 권한, 중지 조건과 새 volume 전환을 먼저 리허설한다. 이 adapter와 복원 리허설이 완료되기 전에는 외부 파일럿을 시작하지 않는다.

1. API를 중지한다. Caddy는 잠시 502를 반환할 수 있다.
2. Docker volume 이름을 `docker volume ls`로 정확히 확인한다.
3. 검증된 백업 도구로 volume 전체를 암호화 백업한다.
4. API를 다시 시작하고 health를 확인한다.
5. 정기적으로 격리된 별도 volume에 복원하여 로그인·영상 조회까지 검증한다.

복원은 기존 데이터를 덮어쓸 수 있는 파괴적 작업이다. 실행 전 대상 volume과 백업 checksum을 이중 확인하고, 파일 복사 중에는 API를 실행하지 않는다. Caddy의 `caddy_data`도 백업할 수 있지만 인증서는 재발급 가능하다. 운영자 secret은 데이터 volume 백업과 분리해 보관한다.

## 개인정보·안전 운영 게이트

실제 참가자를 받기 전에 서비스 운영자와 법률/보안 담당자가 [파일럿 운영·개인정보 처리 준비서](PILOT-OPERATIONS.md)의 D-01~D-13과 아래 항목을 문서화하고 승인해야 한다.

- 개인정보 처리 목적, 항목(GPS·영상·계정), 법적 근거/동의, 열람자, 보관 기간, 파기 방법, 문의·삭제 요청 절차
- 영상 촬영에 등장하는 모든 사람의 동의와 미성년자 처리, Box 관리자 및 판정 운영자의 최소 권한과 교육
- 계정 탈취·부적절 영상·분쟁·유출 신고의 중단/격리/통지 절차와 연락 책임자
- 서버/백업/로그별 접근 명단, MFA, 접근 검토 주기, 복구 목표 및 실제 복구 훈련
- 등록·영상·계정 삭제 기능이 현재 API에 없다는 제한. 수동 DB 편집을 운영 절차로 간주하지 말고, 승인된 삭제/내보내기 기능과 감사 절차가 준비되기 전 공개 모집을 시작하지 않는다.
- 운동 수행은 부상 위험이 있다. 건강 상태 확인, 중단 기준, 현장 응급 대응, Box별 책임 범위를 별도 확정한다.

사고가 의심되면 신규 가입/업로드를 중지하고 보존이 필요한 증거와 삭제 의무를 책임자 판단 아래 분리한다. 비밀번호나 bearer token을 지원 채널로 받지 않는다. 이 파일의 체크리스트 통과만으로 법규 준수나 안전 인증을 주장해서는 안 된다.

## 현재 검증 경계

저장소에서는 runtime config 단위 테스트, 로컬 Node HTTP health smoke test, Caddyfile/Compose/Dockerfile 정적 검사를 수행할 수 있다. 실제 인증서 발급, DNS, 방화벽, container runtime, 외부 Android release 기기 연결, 백업 복원은 대상 인프라와 기기에서 별도로 증거를 남겨야 한다.

2026-09-06 재개 검증: 로컬 Docker CLI는 있으나 Compose 플러그인이 없어 `docker compose ... config --quiet`를 실행하지 못했다. Docker 소켓 접근도 permission denied이며 Caddy 실행 파일도 없어 컨테이너 빌드·기동과 Caddy 설정 검증은 미실행이다. 이 환경에서의 소스 검토와 Node 테스트를 실제 배포 검증으로 대체하지 않는다.
