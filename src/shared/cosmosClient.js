const { CosmosClient } = require('@azure/cosmos');

let client;

function getClient() {
  if (!client) {
    const connectionString = process.env.COSMOS_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error('COSMOS_CONNECTION_STRING 환경 변수가 설정되지 않았습니다. Function App의 "환경 변수"를 확인하세요.');
    }
    client = new CosmosClient(connectionString);
  }
  return client;
}

function getDatabase() {
  return getClient().database('ytdb');
}

function getVideosContainer() {
  return getDatabase().container('videos');
}

function getChannelsContainer() {
  return getDatabase().container('channels');
}

function getScrapbookContainer() {
  return getVideosContainer();
}

module.exports = { getClient, getDatabase, getVideosContainer, getChannelsContainer, getScrapbookContainer };
