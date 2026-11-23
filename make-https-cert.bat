@echo off
chcp 65001 >nul
REM 사내용 HTTPS 인증서 만들기 (브라우저 녹음은 https 주소에서만 동작)
REM 관리자 권한으로 실행하세요. 서버 PC 이름과 IP 로 인증서를 만들고 data\https.pfx 로 저장한 뒤 .env 에 설정을 추가합니다.
cd /d %~dp0
net session >nul 2>&1
if errorlevel 1 (
  echo 관리자 권한이 필요합니다. 이 파일을 마우스 오른쪽 버튼 - "관리자 권한으로 실행" 하세요.
  pause
  exit /b 1
)
if not exist data mkdir data
set /p SRVIP=직원들이 접속할 서버 IP (예: 192.168.0.10, 모르면 Enter): 
set PFXPW=%RANDOM%%RANDOM%%RANDOM%
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$names = @($env:COMPUTERNAME, 'localhost'); if ($env:SRVIP) { $names += $env:SRVIP };" ^
  "$c = New-SelfSignedCertificate -DnsName $names -CertStoreLocation Cert:\LocalMachine\My -NotAfter (Get-Date).AddYears(5) -FriendlyName 'RnD Schedule HTTPS';" ^
  "$pw = ConvertTo-SecureString -String $env:PFXPW -Force -AsPlainText;" ^
  "Export-PfxCertificate -Cert $c -FilePath data\https.pfx -Password $pw | Out-Null;" ^
  "Export-Certificate -Cert $c -FilePath data\https-root.cer | Out-Null;" ^
  "Import-Certificate -FilePath data\https-root.cer -CertStoreLocation Cert:\LocalMachine\Root | Out-Null" || goto :err
>>.env echo.
>>.env echo # HTTPS (make-https-cert.bat 이 추가)
>>.env echo HTTPS_PFX=data/https.pfx
>>.env echo HTTPS_PASSPHRASE=%PFXPW%
echo.
echo 완료. 서버를 다시 시작하면 https://%COMPUTERNAME%:포트 로 접속합니다.
echo 직원 PC 에서 "안전하지 않음" 경고 없이 쓰려면 data\https-root.cer 을
echo 각 PC 에서 더블클릭 - 인증서 설치 - 로컬 컴퓨터 - "신뢰할 수 있는 루트 인증 기관" 에 넣으세요.
pause
goto :eof
:err
echo 오류가 발생했습니다. 위 메시지를 확인하세요.
pause
