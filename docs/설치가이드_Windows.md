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

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| `.env 파일이 없습니다` | `setup-db.bat` 먼저 실행 |
| `password authentication failed` | `.env` 의 `DATABASE_URL` 비밀번호 확인 |
| `ECONNREFUSED ...5432` | PostgreSQL 서비스가 켜져 있는지 (서비스 앱 → postgresql-x64-17) |
| 백업 실패: pg_dump 를 찾을 수 없음 | `.env` 에 `PG_BIN=C:\Program Files\PostgreSQL\17\bin` 추가 |
| 설치 없이 잠깐 시험만 | `.env` 에 `DB_CLIENT=sqlite` 한 줄만 두면 `data\schedule.db` 파일로 동작 |
