# 감시PC 무료 외부접속 실행법

완전 무료로 쓰려면 Cloudflare Quick Tunnel을 사용합니다. 감시PC가 켜져 있는 동안만 외부 주소가 살아 있고, 재부팅하거나 터널을 다시 켜면 주소가 바뀔 수 있습니다.

## 감시PC에서 처음 한 번

```powershell
git clone https://github.com/hanjaehyun123123as/high-price-scanner.git
cd high-price-scanner
powershell -ExecutionPolicy Bypass -File .\FREE_TUNNEL_START.ps1
```

실행하면 화면에 이런 주소가 나옵니다.

```text
https://xxxx-yyyy-zzzz.trycloudflare.com
```

이 주소가 감시PC에 붙은 신고가검색기 주소입니다. 휴대폰이나 다른 PC에서 이 주소로 접속하면 됩니다.

## 매일 쓰는 방식

1. 감시PC에서 `FREE_TUNNEL_START.ps1` 실행
2. 화면에 나온 `https://...trycloudflare.com` 주소 접속
3. 대시보드에서 `오늘 데이터 갱신` 버튼 클릭
4. 그 순간 감시PC가 네이버 데이터를 다시 받아와서 조건을 재계산

## 비밀번호 고정하기

감시PC 폴더 안에 `local-password.txt` 파일을 만들면 그 값을 로그인 비밀번호로 씁니다. 이 파일은 GitHub에 올라가지 않도록 제외되어 있습니다.

예:

```powershell
cd $env:USERPROFILE\Documents\high-price-scanner
Set-Content -Encoding ascii -Path .\local-password.txt -Value '<원하는비밀번호>'
powershell -ExecutionPolicy Bypass -File .\FREE_TUNNEL_START.ps1
```

## 주의

- GitHub Pages 주소는 저장된 데이터 보기용입니다.
- 실시간에 가까운 수동 갱신은 `trycloudflare.com` 터널 주소로 들어가야 됩니다.
- 무료 Quick Tunnel은 테스트/개발용이라 고정 주소와 가동률 보장은 없습니다.
- 감시PC가 꺼지면 외부 주소도 죽습니다.
- 처음 실행할 때 `cloudflared.exe`를 자동 다운로드합니다.
