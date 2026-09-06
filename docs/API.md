# 파일럿 API 계약

기준: `main`/`de13d30`, 개발 정책 `pilot-v1`. JSON API `/api`. 오류는 `{error: 한국어 메시지}`와 적절한 400/401/403/404/409/413 상태. Bearer 세션 인증. 사용자 역할/Box/경기 상태 변경은 서버가 검증한다. 날짜는 UTC ISO 8601.

## 응답 모델

후속 배포 준비에서 요청 Origin 검사를 강화했다. 허용 목록 밖의 Origin이 있으면 OPTIONS뿐 아니라 실제 요청도 변경 처리 전에 403으로 거부한다. Origin이 없는 서버/네이티브 요청은 기존 인증·권한 검사를 따른다. CORS는 인증을 대신하지 않는다. 개발 기본 출처는 유지하고 production은 `https://localhost` 및 설정된 정확한 HTTPS 출처를 사용한다. 자세한 환경 설정과 프록시 제약은 [배포 안내](DEPLOYMENT.md)를 참고한다.

- User: `{id,name,email,role:'athlete'|'operator',boxId:null|string}`
- Box: `{id,name,address,dong,district,lat,lng,description,ownerId,members:string[],checks: [{userId,at}],operatorVerified:boolean,active:boolean,decoration:boolean}`. 위치 확인 원시 좌표는 공개 조회에 포함하지 않는다.
- Template: `{id,name,version,kind:'for-time'|'amrap',description,movements:string[],timeCap:number,totalReps:number,level:'Rx'|'Scaled'}`. 초 단위.
- Match: `{id,title,defenderId,challengerId:null|string,template,format:'individual'|'team3',level,venue:'together'|'separate',location,scheduledAt,submitBy,reviewBy,status:'open'|'applied'|'locked'|'live'|'submitted'|'review'|'disputed'|'finalized'|'cancelled'|'void',rosters:{[boxId]:string[]},agreements:string[],submissions:{[boxId]:Submission},reviews:string[],dispute?:{reason,by},result?:{winnerId:null|string,reason},history:Event[],createdAt}`.
- Submission: `{records:[{userId,completed:boolean,seconds:number,reps:number,noReps:number,note:string,videoSecond:number}],videoId,submittedAt}`. For Time completed 판정과 reps/timeCap의 일치 검증. 팀은 3인 개별 기록 배열.
- Ledger: `{id,boxId,matchId?,kind:'rating'|'points',amount,balance,reason,at}`.
- Snapshot: `{user,users: [{id,name,boxId,role}],boxes,templates,matches,ledger,notifications:[{id,title,body,matchId?}],joinRequests:[{id,userId,boxId,status}],policy,updatedAt,metrics}`. users는 현재 전체 사용자의 ID/이름/소속/역할 목록이며 이메일·비밀번호 검증값은 제외한다. 필요한 Box/경기로 목록 범위를 줄이는 개인정보 검토는 운영 전 과제다. 맹검 대상 submissions는 삭제하고 submissionBoxes:string[]로 제출 여부만 제공. 공개 아닌 경기는 당사자/운영자만 조회.
- Ranking: `{boxId,name,rating,games,rank,provisional,dong,district}`. 순위는 확정 경기만 부문별 재계산.

`Box.active`는 주 소속 구성원과 서로 다른 3명 위치 확인을 뜻하며 운영 권한 승인은 별도 `operatorVerified`다. 공식전 자격은 둘 다 참이어야 한다. 인원 이적으로 자격이 사라지면 새 경기와 잠금 전 합의는 제한하고, 이미 잠긴 명단과 경기 당시 소속은 보존한다. Box 관리자의 소속 이전은 관리 권한 이전 기능이 없는 파일럿에서 제한한다. 위치 원시 좌표는 모든 응답에서 제외하고, 운영 승인 근거 `verification`은 해당 관리자/서비스 운영자의 state 응답에만 제공한다.

Match 추가 필드: 수락 시 `acceptedAt`, 잠금 시 `lockedAt`·`membershipSnapshot`, 확정 시 `finalizedAt`·`finalOrder`·`rewardEligible`. accept 후에도 상태는 `applied`이며 `acceptedAt` 확인 후 agree를 요청한다. 응답의 `submissionBoxes`는 항상 제공한다. rating 원장은 `format`, `level`, 원인이 된 `matchId`를 포함한다. 미참가자의 경기 조회는 `open` 모집 경기만 제공하고, 잠긴 출전 선수는 이적 후에도 해당 경기 접근 권한을 유지한다. `metrics`는 일반 계정에서 null이며 운영자만 집계 값을 조회한다.

## 엔드포인트

| 메서드·경로 | 입력 | 출력/권한 |
| --- | --- | --- |
| GET /health | 없음 | `{ok:true,mode:'pilot'}` |
| POST /auth/register | `{name,email,password}` | `{token,user}`; athlete만 생성 |
| POST /auth/login | `{email,password}` | `{token,user}` |
| POST /auth/logout | 인증 | 세션 폐기 |
| GET /state | 인증 | Snapshot |
| POST /boxes | `{name,address,dong,district,lat,lng,description}` | Box; 생성자 주 소속/관리자, 기존 소속 없어야 함 |
| POST /boxes/:id/join | `{}` | 소속 신청 |
| POST /boxes/:id/approve-member | `{userId}` | Box; owner만, 기존 소속 제거·현재 소속 변경, 과거 명단 불변 |
| POST /boxes/:id/check-in | `{lat,lng,accuracy,timestamp,consent:true}` | Box; 자기 계정만, 거리·정확도·시간 확인 |
| POST /boxes/:id/verify | `{approved:true,reason}` | Box; operator만 |
| POST /boxes/:id/decorate | `{}` | 포인트 30 소비·최초 1회; owner만 |
| POST /matches | `{title,templateId,format,venue,location,scheduledAt}` | Match; active/verified Box owner. submitBy=경기+24h, reviewBy=경기+48h |
| POST /matches/:id/apply | `{}` | Match; 다른 active Box owner |
| POST /matches/:id/accept | `{}` | Match; defender owner |
| POST /matches/:id/agree | `{roster:string[]}` | Match; 양측 owner; 양측 동의 완료 시 locked |
| POST /matches/:id/start | `{}` | Match; 당사자 owner, scheduledAt 이후 |
| POST /matches/:id/cancel | `{reason}` | Match; 당사자 owner, open/applied/locked만. 시작 후 운영자 판정으로 처리 |
| POST /matches/:id/video | multipart `video`, `consent=true` | `{videoId}`; 당사자 owner/명단 참가자, 100MB 상한, MP4/WebM 형식·헤더 확인 |
| GET /videos/:id | 인증 | 비공개 파일 스트림, 당사자/운영자만·맹검 적용 |
| POST /matches/:id/submit | `{videoId,records:[...]}` | Match; 자기 Box owner, 잠긴 명단과 일치·업로드 소유·기한 검증; 동일 재시도 멱등 |
| POST /matches/:id/review | `{approved:boolean,reason?:string}` | Match; 양측 owner; false이면 disputed. 본인 자료 확인만으로 확정 불가 |
| POST /matches/:id/finalize | `{}` | 양측 검토+reviewBy 경과 후 확정·원장 반영. 같은 이벤트 재요청 안전 |
| POST /matches/:id/resolve | `{action:'finalize'|'void',reason}` | operator; 자기 출전·소속 경기 불가; 분쟁/미응답/미제출 처리 근거 기록 |
| POST /matches/:id/correct | `{action:'void'|'result',winnerId?:string|null,reason}` | operator; finalized/void 정정·과거 원본/근거 보존·연쇄 레이팅 재계산 |
| GET /rankings?format=individual&level=Rx&district=성동구&dong=성수동 | 인증 | `{rankings,updatedAt}` |

## 서버 구성

`server/index.mjs`: CLI 서버; 기본 127.0.0.1:8787. `server/app.mjs`의 `createApp({dataDir,clock?,operatorEmail?,operatorPassword?})`는 `{app,close}`를 반환해 격리 테스트 가능하게 한다. 기본 데이터 경로 `data/`, 환경 변수 `WODSIEGE_DATA_DIR`, `HOST`, `PORT`. 운영자 생성은 `WODSIEGE_OPERATOR_EMAIL/PASSWORD`를 둘 다 명시한 경우만. 공개 하드코딩 비밀번호나 운영자 자동 로그인 없음. 테스트는 DB를 독립 생성하고 clock 주입으로 기한 검증한다.

SQLite 변경은 트랜잭션 단위, 로그인 password scrypt 해시, 세션 만료, 업로드 파일 UUID와 메타데이터. 서버는 개발용 예시 Box를 자동 승인하지 않는다. 앱은 최초 가입부터 직접 수행 가능. E2E fixture는 테스트 서버에만 만든다.

현재 SQLite 저장은 파일럿 규모의 단일 aggregate JSON을 `BEGIN IMMEDIATE` 트랜잭션에서 읽고 변경·저장하는 방식이다. 인덱스 기반 대규모 조회/멀티 리전 동시 쓰기는 출시 전 별도 설계 대상이다. 비밀번호는 10자 이상, 세션 유효 기간은 24시간이다. 기본 CORS 허용 origin은 Capacitor의 `https://localhost`, `http://localhost` 및 로컬 개발/미리보기 주소다.

검토 기한 내 양측의 상대 기록 확인이 필요하다. 기한 경과 미응답/미제출은 자동 승패로 처리하지 않는다. 운영자의 finalize도 양측 제출 증거를 요구하고, 미제출은 근거를 남겨 void 처리한다. 분쟁은 별도 이의 근거를 보존하며 독립 운영자만 판정한다. 하루 반복 상대 제한은 Asia/Seoul의 경기 예정 날짜 기준이고 형식/수준을 바꿔도 같은 Box 쌍은 하루 한 번만 보상·레이팅을 받는다. 정정은 기존 원장을 삭제하지 않고 차액을 추가하며 확정 순서로 후속 레이팅을 재계산한다. 제출에 사용되지 않은 재시도 영상은 상대에게 공개하지 않는다.
