function requestTargetTable_(type) {
  return type === 'post' ? 'Posts' : type === 'comment' ? 'Comments' : null;
}
function adminListDeleteRequests() {
  return adminCall_(config => withTopicLock_(() => {
    const posts = moderationTable_(config, 'Posts');
    const comments = moderationTable_(config, 'Comments');
    const postMap = new Map(posts.records.map(r => [r.values[0], r]));
    const commentMap = new Map(comments.records.map(r => [r.values[0], r]));
    return moderationTable_(config, 'DeleteRequests').records.map(record => {
      const r = record.values, type = r[1];
      const target = type === 'post' ? postMap.get(r[2]) : type === 'comment' ? commentMap.get(r[2]) : null;
      const t = target && target.values;
      const parent = t && type === 'comment' ? postMap.get(t[1]) : null;
      return { id: r[0], targetType: moderationString_(type), targetId: moderationString_(r[2]),
        reason: moderationString_(r[4]), createdAt: moderationDate_(r[5]), status: moderationString_(r[6]),
        revision: topicRevision_(r), target: t ? {
          title: type === 'post' ? moderationString_(t[4]) : (parent ? moderationString_(parent.values[4]) : '作品が見つかりません'),
          displayName: moderationString_(t[3]), body: moderationString_(t[type === 'post' ? 5 : 4]),
          replyTo: type === 'comment' ? moderationString_(t[5]) : '',
          status: moderationString_(t[t.length - 1]), contentRevision: moderationContentRevision_(target)
        } : null };
    });
  }));
}
function adminResolveDeleteRequest(input) {
  return adminCall_(config => withTopicLock_(() => {
    topicInput_(input, ['id', 'decision', 'revision', 'targetRevision', 'targetStatus']);
    if (typeof input.id !== 'string' || !input.id || typeof input.revision !== 'string' ||
        ['approved', 'rejected'].indexOf(input.decision) === -1) adminFail_('VALIDATION', '申請ID・処理内容を確認してください。');
    const requests = moderationTable_(config, 'DeleteRequests');
    const record = moderationFind_(requests, input.id), r = record.values;
    if (r[6] !== 'pending') adminFail_('STATUS', '処理済み、または想定外の状態です。一覧を再読み込みしてください。');
    if (topicRevision_(r) !== input.revision) adminFail_('CONFLICT', '申請内容が更新されています。一覧を再読み込みしてください。');
    if (input.decision === 'approved') {
      const name = requestTargetTable_(r[1]);
      if (!name) adminFail_('VALIDATION', '対象種別が不明な申請は承認できません。');
      const table = moderationTable_(config, name), target = moderationFind_(table, r[2]);
      const status = target.values[table.statusColumn - 1];
      if (!moderationKnown_(status)) adminFail_('STATUS', '対象が想定外の状態のため承認できません。');
      if (typeof input.targetRevision !== 'string' || moderationContentRevision_(target) !== input.targetRevision ||
          !moderationKnown_(input.targetStatus) || (status !== input.targetStatus && status !== 'deleted')) {
        adminFail_('CONFLICT', '対象の内容・状態が更新されています。一覧を再読み込みして確認してください。');
      }
      // Sheets has no cross-sheet transaction. Commit target first; retry can finish a pending
      // request whose target is already deleted, without ever restoring or deleting a row.
      if (status !== 'deleted') moderationWriteStatus_(table, target, 'deleted');
    }
    moderationWriteStatus_(requests, record, input.decision);
    return { id: input.id, status: input.decision };
  }));
}
