# AGENTS.md

## Resource And Cost Decisions

- Azure, GitHub, YouTube API, 데이터베이스 또는 유료 서비스 변경 전 `.kaion/project-resources.json`과 카이온 중앙 자원 원장을 먼저 확인합니다.
- 이미 연결된 Azure Sponsorship, Functions Flex Consumption, Cosmos DB Free Tier와 YouTube Data API를 기준으로 판단합니다.
- 저장된 Cloud 데이터 조회와 YouTube API 신규 수집을 분리합니다.
- 비용성 수집의 기본값은 채널 하나, 수동 실행, 최대 100개, 자동 반복 없음입니다.
- 새 Azure 자원, Cosmos 컨테이너, 자동 반복 수집 또는 API 할당량 증가에는 사전 승인이 필요합니다.
- 백필은 일반 스캔 요약과 분리된 재개 상태를 유지하고 기존 저장 의미를 바꾸지 않습니다.
- 승인된 자원 변경은 프로젝트 선언서와 중앙 자원대장·사용 이력에 함께 기록합니다.
- 토큰, API 키, 연결 문자열과 결제 식별자는 저장소에 기록하지 않습니다.
