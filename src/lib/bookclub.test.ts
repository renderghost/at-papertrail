import { describe, expect, it } from 'vitest'
import { entry, profile } from '../test/fixtures'
import { buildBookClub } from './bookclub'
import { STATUS } from './bookhive/types'

const me = profile('me.test')
const alice = profile('alice.test')
const bob = profile('bob.test')
const carol = profile('carol.test')

describe('buildBookClub', () => {
  const mine = entry(me, { title: 'Piranesi', authors: 'Susanna Clarke', status: STATUS.reading })

  it('splits matches into reading now and have read', () => {
    const [club] = buildBookClub(
      [mine],
      [
        { profile: alice, books: [entry(alice, { title: 'Piranesi', authors: 'Susanna Clarke', status: STATUS.reading })] },
        {
          profile: bob,
          books: [
            entry(bob, {
              title: 'Piranesi',
              authors: 'Susanna Clarke',
              status: STATUS.finished,
              finishedAt: '2024-11-02T00:00:00.000Z',
            }),
          ],
        },
        { profile: carol, books: [entry(carol, { title: 'Piranesi', authors: 'Susanna Clarke', status: STATUS.wantToRead })] },
      ],
    )
    expect(club!.reading.map((m) => m.profile.handle)).toEqual(['alice.test'])
    expect(club!.haveRead.map((m) => [m.profile.handle, m.finishedAt])).toEqual([
      ['bob.test', '2024-11-02T00:00:00.000Z'],
    ])
  })

  it('matches by ISBN or normalised title when hiveIds differ', () => {
    const [club] = buildBookClub(
      [{ ...mine, value: { ...mine.value, identifiers: { isbn13: '9781635575637' } } }],
      [
        {
          profile: alice,
          books: [
            {
              ...entry(alice, { title: 'Piranesi (Hardback)', authors: 'S. Clarke', status: STATUS.reading }),
            },
          ].map((e) => ({ ...e, value: { ...e.value, identifiers: { isbn13: '9781635575637' } } })),
        },
        { profile: bob, books: [entry(bob, { title: 'piranesi', authors: 'susanna clarke', status: STATUS.reading })] },
      ],
    )
    expect(club!.reading.map((m) => m.profile.handle).sort()).toEqual(['alice.test', 'bob.test'])
  })

  it('counts an earlier read of a book someone has since put back on their list', () => {
    const [club] = buildBookClub(
      [mine],
      [
        {
          profile: alice,
          books: [
            entry(alice, {
              title: 'Piranesi',
              authors: 'Susanna Clarke',
              status: STATUS.wantToRead,
              previousReads: [{ finishedAt: '2021-01-01T00:00:00.000Z' }],
            }),
          ],
        },
      ],
    )
    expect(club!.haveRead).toHaveLength(1)
  })

  it('only covers books I am currently reading', () => {
    const finished = entry(me, { title: 'Dune', authors: 'Frank Herbert', status: STATUS.finished })
    expect(buildBookClub([finished], [])).toEqual([])
  })
})
