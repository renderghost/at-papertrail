// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HandleCombobox } from './HandleCombobox'

const ACTORS = [
  { did: 'did:plc:alice', handle: 'alice.test', displayName: 'Alice Moreno', avatar: 'https://cdn.test/alice.jpg' },
  { did: 'did:plc:alex', handle: 'alex.test' },
]

const fetchMock = vi.fn<typeof fetch>()

function Harness({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(value)
      }}
    >
      <label htmlFor="identifier">Handle</label>
      <HandleCombobox id="identifier" value={value} onChange={setValue} />
    </form>
  )
}

function setup() {
  const onSubmit = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <Harness onSubmit={onSubmit} />
    </QueryClientProvider>,
  )
  const input = screen.getByRole('combobox', { name: 'Handle' }) as HTMLInputElement
  const type = (text: string) => fireEvent.change(input, { target: { value: text } })
  const key = (k: string) => fireEvent.keyDown(input, { key: k })
  const enter = () => {
    // Enter on a field submits its form unless the key handler prevented it.
    if (fireEvent.keyDown(input, { key: 'Enter' })) fireEvent.submit(input.form!)
  }
  return { input, type, key, enter, onSubmit }
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => Response.json({ actors: ACTORS }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('HandleCombobox', () => {
  it('suggests accounts as you type, and says how many', async () => {
    const { input, type } = setup()
    type('al')
    await screen.findByRole('option', { name: /Alice Moreno/ })
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('status').textContent).toBe('2 matching accounts. Use the arrow keys to choose.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).toContain('q=al&')
  })

  it('picks the highlighted account with ↓ and Enter, without submitting', async () => {
    const { input, type, key, enter, onSubmit } = setup()
    type('al')
    await screen.findAllByRole('option')
    key('ArrowDown')
    key('ArrowDown')
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1]!.id)
    key('ArrowUp')
    enter()
    expect(input.value).toBe('alice.test')
    expect(onSubmit).not.toHaveBeenCalled()
    expect(input.getAttribute('aria-expanded')).toBe('false')
    // The next Enter signs in.
    enter()
    expect(onSubmit).toHaveBeenCalledWith('alice.test')
  })

  it('leaves Enter alone when nothing is highlighted', async () => {
    const { type, enter, onSubmit } = setup()
    type('alic')
    await screen.findAllByRole('option')
    enter()
    expect(onSubmit).toHaveBeenCalledWith('alic')
  })

  it('closes once the field holds a suggested handle in full, uncovering the sign-in button', async () => {
    const { input, type } = setup()
    type('alic')
    await screen.findAllByRole('option')
    type('@Alice.test')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('false'))
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('picks with a click, and closes with Escape', async () => {
    const { input, type, key } = setup()
    type('al')
    fireEvent.click(await screen.findByRole('option', { name: /alex\.test/ }))
    expect(input.value).toBe('alex.test')
    type('ali')
    await screen.findAllByRole('option')
    key('Escape')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('stays out of the way when the service fails', async () => {
    fetchMock.mockImplementation(async () => new Response('{"error":"RateLimitExceeded"}', { status: 429 }))
    const { input, type, enter, onSubmit } = setup()
    type('al')
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(input.getAttribute('aria-expanded')).toBe('false')
    enter()
    expect(onSubmit).toHaveBeenCalledWith('al')
  })

  it("doesn't search for a DID", async () => {
    const { type } = setup()
    type('did:plc:alice')
    await new Promise((r) => setTimeout(r, 250))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
