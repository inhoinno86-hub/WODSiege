# Step 01 — 기반과 API 계약

## 목표와 기준

main/de13d30 기준의 비어 있는 앱 저장소에 재현 가능한 기반을 만든다. 원본 기획 §4~14, intent D-01~D-13을 읽는다.

## 실행 지시

1. package.json, TypeScript/Vite/Capacitor 설정, 앱 진입 파일을 작성하고 의존성을 설치한다.
2. `docs/API.md`에 UI/서버 간 인증·조회·명령·업로드 계약을 작성한다.
3. `docs/PILOT-POLICY.md`에 개발용 수치와 미확정 운영 정책을 분리해 적는다.
4. .gitignore에 intent 및 빌드·개인 데이터 제외를 추가한다.

## 제약·산출물

기존 docs/reports 보존. 비밀·개인 데이터·빌드 캐시는 추적하지 않는다. 외부 배포 제외. 산출물은 설정, 잠금 파일, API/정책 문서.

## 완료 기준

- 의존성 설치 성공 및 lockfile 존재.
- API와 정책 문서에서 서버 검증 책임과 데이터 구조 확인 가능.
- `git check-ignore intent-docs/INTENT-2026-09-06-wodsiege-android-pilot.md` 성공.

## 인계

02/03은 같은 API 계약과 정책을 사용한다. 주요 계약 변경은 통합 담당자가 양쪽을 조정한다.
