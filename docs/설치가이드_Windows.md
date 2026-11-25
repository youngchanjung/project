# 설치·실행 가이드 (Windows)

개발 PC(내 PC)에서 먼저 설치해 써 보고, 나중에 같은 순서로 서버 PC에 설치합니다.
명령 입력은 **명령 프롬프트(cmd)** 기준입니다.

## 1. 필요한 프로그램 설치 (처음 한 번)

| 프로그램 | 받는 곳 | 설치 시 주의 |
|---|---|---|
| Node.js LTS (20 이상) | <https://nodejs.org> | 기본 옵션 그대로 |
| Git | <https://git-scm.com/download/win> | 기본 옵션 그대로 |
| PostgreSQL 17 (또는 16) | <https://www.postgresql.org/download/windows/> → "Download the installer" | **postgres 관리자 비밀번호**를 정하라고 나옵니다. 꼭 적어 두세요. 포트는 기본 5432. Stack Builder 는 건너뛰어도 됩니다. |

## 2. 프로그램 받기

```
cd C:\
git clone https://github.com/youngchanjung/project.git schedule
cd schedule
```
(내 PC 에서는 원하는 폴더에 받아도 됩니다. 이후 설명의 `C:\schedule` 을 그 폴더로 바꿔 읽으세요.)

## 3. DB 준비 (처음 한 번)

`setup-db.bat` 더블클릭 →
1. PostgreSQL 설치 때 정한 **postgres 비밀번호** 입력
2. 일정관리 프로그램용 **새 비밀번호** 입력 (영문·숫자만)

`schedule` 이라는 DB 와 계정이 만들어지고, 접속 정보가 담긴 `.env` 파일이 생깁니다.
(다른 설정은 `.env.example` 을 참고해 `.env` 에 추가합니다.)

## 4. 실행

`start-server.bat` 더블클릭 → 처음에는 설치와 화면 빌드를 자동으로 하고 서버가 켜집니다.
창을 닫으면 서버가 꺼집니다.

1. 브라우저에서 <http://localhost:3000> 접속
2. **처음 접속 시 관리자 계정**을 만듭니다.
3. 상단 **관리** 메뉴에서 초기 데이터를 입력합니다.
   - **부서**: `+ 부서 추가` (상위 부서 지정 가능)
   - **직원 계정**: 한 명씩 `+ 계정 추가`, 또는 `엑셀로 일괄 등록` → 양식 내려받기 → 작성 → 미리 보기 → 등록 실행
   - **권한**: 직원별 `관리자`/`일반`. 프로젝트별 역할(PM·참여자·조회자)은 각 프로젝트의 **설정 → 참여자**에서 지정
   - **공휴일**: 한국 공휴일은 기본으로 들어 있음. 베트남 등은 직접 추가하거나 계약 일정 엑셀을 불러오면 함께 들어옴

## 5. 매주 금요일 저녁 자동 백업 등록

`register-backup-task.bat` 을 **마우스 오른쪽 버튼 → 관리자 권한으로 실행**.
매주 금요일 **19:00** 에 백업하도록 Windows 작업 스케줄러에 등록됩니다.
(시간을 바꾸려면 관리자 명령 프롬프트에서 `register-backup-task.bat 20:30`)

- 백업 파일: `data\backups\schedule_날짜_시간.dump`, 최근 12개(약 3개월) 보관
- 첨부·현장 사진(`data\attachments`)과 회의 녹음(`data\meetings`)은 `data\backups\files\` 아래에 함께 복사됩니다. 새로 생기거나 바뀐 파일만 복사하고, 프로그램에서 지운 파일도 백업에는 남겨 둡니다. 복원할 때는 이 폴더를 `data\` 아래로 다시 복사하면 됩니다.
- PC 고장에 대비해 다른 곳에도 복사하려면 `.env` 에 `BACKUP_COPY_DIR=\\NAS\backup\schedule` 처럼 지정
  (작업은 SYSTEM 계정으로 실행되므로 네트워크 폴더는 서버 PC 컴퓨터 계정에 쓰기 권한이 있어야 합니다)
- 결과 확인: 프로그램 **관리** 화면의 **DB 백업** 카드 (최근 결과, 파일 목록, `지금 백업` 버튼)
- 백업 시각에 PC 가 켜져 있어야 합니다. 꺼져 있었다면 다음 주에 실행됩니다.
- 시험 실행: `schtasks /Run /TN "RnDSchedule\WeeklyBackup"`

### 백업에서 복원하기

> 현재 DB 내용이 백업 시점으로 바뀝니다. 서버를 끄고 진행하세요.

```
cd "C:\Program Files\PostgreSQL\17\bin"
dropdb -U postgres -h localhost schedule
createdb -U postgres -h localhost -O schedule -E UTF8 -T template0 schedule
pg_restore -U postgres -h localhost --no-owner --role=schedule -d schedule "C:\schedule\data\backups\schedule_20261127_1900.dump"
```

## 6. 다른 직원이 접속하게 하기 (서버 PC)

- 직원들은 `http://서버PC이름:3000` 또는 `http://서버IP:3000` 으로 접속합니다.
- 접속이 안 되면 **Windows 방화벽 → 고급 설정 → 인바운드 규칙 → 새 규칙 → 포트 → TCP 3000 허용**.
- 서버 PC 가 재부팅돼도 자동으로 켜지게 하려면 [NSSM](https://nssm.cc) 으로 서비스 등록:
  ```
  nssm install RnDSchedule "C:\Program Files\nodejs\node.exe" "C:\schedule\server\src\index.js"
  nssm set RnDSchedule AppDirectory "C:\schedule\server"
  nssm start RnDSchedule
  ```

## 7. 내 PC → 서버 PC 로 옮기기

1. 서버 PC 에 1~3단계 진행 (DB 는 비어 있는 상태로 준비)
2. 내 PC 에서 **관리 → DB 백업 → 지금 백업**
3. 생긴 `.dump` 파일을 서버 PC 로 복사한 뒤, 위 **복원하기** 명령으로 서버 PC DB 에 넣기
4. 서버 PC 에서 `start-server.bat` → 5단계(백업 등록), 6단계(방화벽·서비스) 진행

## 8. 업데이트

GitHub 에 새 버전이 올라오면 `update-server.bat` 실행 후 서버를 다시 시작합니다.
DB 구조 변경은 서버가 시작될 때 자동으로 적용됩니다. (업데이트 전에 `지금 백업` 권장)

## 9. 회의 녹음·AI 회의록 정리 설정

프로젝트 화면의 **회의록** 탭에서 회의를 녹음(또는 녹음 파일 업로드)하면, 음성을 글로 바꾸고(Microsoft Azure Speech) AI가 요약·결정 사항·할 일·이슈로 정리합니다(Claude).
할 일과 이슈는 **작업으로 등록 / 이슈로 등록** 버튼으로 바로 프로젝트에 넣을 수 있습니다.

1. **Azure Speech 키**: <https://portal.azure.com> → 리소스 만들기 → **Speech**(음성 서비스) 생성 (지역은 가까운 곳, 예: Korea Central / Southeast Asia, 가격 계층은 Standard S0)
   → 만든 리소스의 **키 및 엔드포인트** 화면에서 키 1개와 지역을 복사 → `.env` 의 `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` 에 넣기
   - 회사 Microsoft 365 와 같은 계정(Entra ID)으로 Azure 구독을 만들면 결제·관리가 한곳에서 됩니다.
   - 방식: Azure "빠른 전사(Fast transcription)" — 파일을 보내면 녹음 길이보다 빨리 결과가 옵니다. 파일 한도 500MB 미만, 5시간 미만.
   - 요금: 녹음 시간 기준으로 과금됩니다. 정확한 금액은 [Azure Speech 가격](https://azure.microsoft.com/pricing/details/speech/) 의 "Fast Transcription" 항목에서 확인하세요. (무료 F0 계층의 월 5시간은 실시간 인식용이라 이 기능에는 S0 를 권장)
   - 회의 언어: 한국어(ko-KR)·베트남어(vi-VN)·영어(en-US)는 그 언어로, **여러 언어 섞임**은 언어를 지정하지 않고 다국어 모델이 문장마다 언어를 알아냅니다. 화자는 자동으로 구분됩니다(최대 `AZURE_MAX_SPEAKERS`명, 기본 10).
   - 브라우저 녹음은 webm(크롬·엣지) 또는 wav 로 저장됩니다. 휴대폰·Teams 녹음(m4a, mp4)도 올릴 수 있지만, 음성인식이 읽지 못하면 mp3 나 wav 로 바꿔 올려 주세요.
2. **Claude 키**: <https://console.anthropic.com> → API Keys 에서 발급 → `.env` 의 `ANTHROPIC_API_KEY` 에 넣기
   - 1시간 회의 정리에 약 0.1~0.3달러(수백 원) 정도 듭니다. (전사본 길이에 따라 다름)
3. **HTTPS 설정 (사내 IP 로 녹음하려면 필수)**: 브라우저는 보안 연결이 아닌 주소(`http://서버IP:3000`)에서 마이크를 막습니다.
   - 서버 PC 에서 `make-https-cert.bat` 을 **관리자 권한으로 실행** → 서버 다시 시작 → 직원은 `https://서버PC이름:3000` 으로 접속
   - 직원 PC 에 경고가 뜨지 않게 하려면 `data\https-root.cer` 을 각 PC 의 "신뢰할 수 있는 루트 인증 기관"에 설치 (IT 담당자가 그룹 정책으로 한 번에 배포 가능)
   - 회사에 정식 인증서가 있으면 `.env` 의 `HTTPS_PFX` 로 그 파일을 지정
   - HTTPS 전에도 휴대폰 녹음 앱·Teams 녹음 파일(mp3, wav, m4a 등)을 올리는 방식은 그대로 쓸 수 있습니다.
4. 서버 다시 시작

참고
- 녹음 파일은 `data\meetings` 에 저장되고, 매주 백업 때 `data\backups\files\meetings` 로 함께 복사됩니다.
- 음성은 Microsoft Azure(선택한 지역의 데이터센터)로, 전사본은 Anthropic(Claude) 서버로 전송되어 처리됩니다. 사내 보안 규정을 확인하세요.
- AI 정리는 실수가 있을 수 있으니 중요한 내용은 녹음·전사본과 대조해 확인하세요. 정리 내용은 **정리 내용 고치기**로 직접 수정할 수 있습니다.

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| `.env 파일이 없습니다` | `setup-db.bat` 먼저 실행 |
| `password authentication failed` | `.env` 의 `DATABASE_URL` 비밀번호 확인 |
| `ECONNREFUSED ...5432` | PostgreSQL 서비스가 켜져 있는지 (서비스 앱 → postgresql-x64-17) |
| setup-db.bat 에서 "postgres 비밀번호로 접속하지 못했습니다" | PostgreSQL 이 여러 버전 설치된 PC 는 버전마다 포트·비밀번호가 다릅니다. 서비스 앱에서 실행 중인 버전을 보고, 그 버전의 포트(data\postgresql.conf 의 port)와 그 버전을 설치할 때 정한 비밀번호를 넣으세요. |
| 백업 실패: pg_dump 를 찾을 수 없음 | `.env` 에 `PG_BIN=C:\Program Files\PostgreSQL\17\bin` 추가 |
| 설치 없이 잠깐 시험만 | `.env` 에 `DB_CLIENT=sqlite` 한 줄만 두면 `data\schedule.db` 파일로 동작 |
| 회의록에서 "브라우저가 마이크를 막습니다" | https 주소로 접속했는지 (9단계 3번). 서버 PC 에서는 `http://localhost:3000` 도 녹음 가능 |
| 회의록이 "오류" 상태 | 오류 문구 확인. Azure Speech 키·지역, Claude 키, 남은 사용량, 인터넷 연결 확인 후 "음성인식 다시 하기" 또는 "AI 정리" |
