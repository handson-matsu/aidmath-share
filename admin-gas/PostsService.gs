function postAdminDto_(record, topics) {
  const r = record.values;
  return { id: r[0], topicId: moderationString_(r[1]), topicTitle: topics.get(r[1]) || 'テーマ不明',
    displayName: moderationString_(r[3]), title: moderationString_(r[4]), body: moderationString_(r[5]),
    createdAt: moderationDate_(r[7]), status: moderationString_(r[8]), revision: topicRevision_(r) };
}
function adminListPosts() {
  return adminCall_(config => {
    const topics = new Map(topicRows_(topicSheet_(config)).map(r => [r.values[0], r.values[1]]));
    return moderationTable_(config, 'Posts').records.map(r => postAdminDto_(r, topics));
  });
}
function adminSetPostStatus(input) {
  return adminCall_(config => withTopicLock_(() => moderationUpdate_(config, 'Posts', input)));
}
