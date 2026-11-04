"""Read the complete user library despite PostgREST's default page limit."""


def list_user_words(client, user_id, columns='*', collection_id=None):
    items, start = [], 0
    while True:
        # Build each request afresh: PostgREST .range() appends offset/limit params.
        query = client.table('words').select(columns).eq('user_id', user_id)
        if collection_id == 'unassigned':
            query = query.is_('collection_id', 'null')
        elif collection_id and collection_id != 'all':
            query = query.eq('collection_id', collection_id)
        page = query.order('id').range(start, start + 999).execute().data or []
        if not page:
            return items
        items.extend(page)
        start += len(page)
