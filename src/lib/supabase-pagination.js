const DEFAULT_PAGE_SIZE = 1_000

export async function selectAllRows(createOrderedQuery, { pageSize = DEFAULT_PAGE_SIZE } = {}) {
  if (typeof createOrderedQuery !== 'function') throw new TypeError('An ordered query factory is required')
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError('pageSize must be a positive integer')

  const rows = []
  for (let from = 0; ; from += pageSize) {
    const response = await createOrderedQuery().range(from, from + pageSize - 1)
    if (response.error) return response

    const page = response.data || []
    rows.push(...page)
    if (page.length < pageSize) return { ...response, data: rows }
  }
}
