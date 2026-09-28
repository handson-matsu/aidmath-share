function commentAdminDto_(record, posts) {
  const r = record.values, post = posts.get(r[1]);
  return { id: r[0], postId: moderationString_(r[1]), postTitle: post ? moderationString_(post.values[4]) : '作品が見つかりません',
    postStatus: post ? moderationString_(post.values[8]) : '', displayName: moderationString_(r[3]),
    body: moderationString_(r[4]), replyTo: moderationString_(r[5]), createdAt: moderationDate_(r[6]),
    status: moderationString_(r[7]), revision: topicRevision_(r) };
}
function adminListComments() {
  return adminCall_(config => {
    const posts = new Map(moderationTable_(config, 'Posts').records.map(r => [r.values[0], r]));
    return moderationTable_(config, 'Comments').records.map(r => commentAdminDto_(r, posts));
  });
}
function adminSetCommentStatus(input) {
  return adminCall_(config => withTopicLock_(() => moderationUpdate_(config, 'Comments', input)));
}
