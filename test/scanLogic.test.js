const assert = require('assert');
const { daysSince, needsStatsRefresh } = require('../src/shared/scanLogic');
const { parseDuration, parseChannelInput } = require('../src/shared/youtube');

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().substring(0, 10);
}

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

// 1. daysSince 기본 동작
assert.strictEqual(daysSince(daysAgo(10)), 10, 'daysSince: 10일 전 계산이 맞아야 함');
assert.strictEqual(daysSince(daysAgo(0)), 0, 'daysSince: 오늘 날짜는 0이어야 함');

// 2. 최근 영상(90일 이내)은 항상 갱신 대상
const recentVideo = { uploadDate: daysAgo(30), lastStatsRefreshAt: isoDaysAgo(1) };
assert.strictEqual(needsStatsRefresh(recentVideo), true, '최근 영상은 매번 갱신되어야 함');

// 3. 오래된 영상(90일+) + 최근에 갱신됨(7일 이내) -> 갱신 불필요
const oldButRecentlyRefreshed = { uploadDate: daysAgo(200), lastStatsRefreshAt: isoDaysAgo(2) };
assert.strictEqual(needsStatsRefresh(oldButRecentlyRefreshed), false, '오래된 영상은 최근 갱신했으면 건너뛰어야 함');

// 4. 오래된 영상 + 갱신 주기(7일) 지남 -> 갱신 필요
const oldAndStale = { uploadDate: daysAgo(200), lastStatsRefreshAt: isoDaysAgo(10) };
assert.strictEqual(needsStatsRefresh(oldAndStale), true, '갱신 주기가 지난 오래된 영상은 갱신되어야 함');

// 5. 갱신 기록이 없는 오래된 영상 -> 무조건 갱신
const neverRefreshed = { uploadDate: daysAgo(200), lastStatsRefreshAt: undefined };
assert.strictEqual(needsStatsRefresh(neverRefreshed), true, '갱신 기록이 없으면 갱신되어야 함');

// 6. parseDuration: 쇼츠 판별 (61초 이하)
assert.strictEqual(parseDuration('PT45S').isShorts, true, '45초는 쇼츠여야 함');
assert.strictEqual(parseDuration('PT1M30S').isShorts, false, '1분 30초는 쇼츠가 아니어야 함');
assert.strictEqual(parseDuration('PT10M').formatted, '10:00', '10분 포맷팅 확인');

console.log('✅ 모든 테스트 통과! (daysSince, needsStatsRefresh, parseDuration 로직 정상)');

// 7. parseChannelInput: 입력값 종류 자동 인식
assert.deepStrictEqual(parseChannelInput('@핫하군'), { type: 'handle', value: '@핫하군' }, '핸들 그대로 인식');
assert.deepStrictEqual(parseChannelInput('mkbhd'), { type: 'handle', value: 'mkbhd' }, '@없는 핸들도 인식');
assert.deepStrictEqual(parseChannelInput('UCBJycsmduvYEL83R_U4JriQ'), { type: 'channelId', value: 'UCBJycsmduvYEL83R_U4JriQ' }, '채널ID(UC..) 인식');
assert.deepStrictEqual(parseChannelInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), { type: 'video', value: 'dQw4w9WgXcQ' }, 'watch 링크 -> 영상ID 추출');
assert.deepStrictEqual(parseChannelInput('https://youtu.be/dQw4w9WgXcQ'), { type: 'video', value: 'dQw4w9WgXcQ' }, '단축 링크 -> 영상ID 추출');
assert.deepStrictEqual(parseChannelInput('https://www.youtube.com/shorts/F4F1H7Js3T4'), { type: 'video', value: 'F4F1H7Js3T4' }, 'shorts 링크 -> 영상ID 추출');
assert.deepStrictEqual(parseChannelInput('https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ'), { type: 'channelId', value: 'UCBJycsmduvYEL83R_U4JriQ' }, '채널 링크 -> 채널ID 추출');
assert.deepStrictEqual(parseChannelInput('https://www.youtube.com/@핫하군'), { type: 'handle', value: '@핫하군' }, '한글 핸들 채널 링크 인식');

console.log('✅ URL 자동 인식 테스트도 전부 통과!');
