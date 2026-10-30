import { createContext, useContext, useId, useState, type ReactNode } from 'react'
import { formFromRecord, recordFromForm, type EditForm } from '../lib/bookhive/edit'
import type { BookEntry } from '../lib/bookhive/types'
import { describeError } from '../lib/errors'
import { useBookWrites } from '../lib/hooks'
import { StarInput } from './bits'
import { Dialog } from './Dialog'
import { useToast } from './Toast'

/**
 * The prompts after a status change (#106, part 2). Marking a book Read with
 * no review yet asks how it was; abandoning one asks where you stopped and,
 * if you like, why. Both save with the book page's own rules, say so with
 * Undo, and can be put off with Not now. They're shown here, above the page,
 * so a card that leaves its list when its status changes (Continue a series,
 * Pick my next read) doesn't take its prompt with it.
 */

export type StatusPrompt = { kind: 'review' | 'stopped'; entry: BookEntry; totalPages?: number }

const PromptContext = createContext<(prompt: StatusPrompt) => void>(() => {})

export function useStatusPrompt() {
  return useContext(PromptContext)
}

let opened = 0

export function StatusPromptProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<(StatusPrompt & { id: number }) | null>(null)
  const close = () => setPrompt(null)
  return (
    <PromptContext.Provider value={(p) => setPrompt({ ...p, id: ++opened })}>
      {children}
      {prompt?.kind === 'review' && <ReviewPrompt key={prompt.id} entry={prompt.entry} onClose={close} />}
      {prompt?.kind === 'stopped' && <StoppedPrompt key={prompt.id} entry={prompt.entry} totalPages={prompt.totalPages} onClose={close} />}
    </PromptContext.Provider>
  )
}

const today = () => new Date().toISOString().slice(0, 10)

/** Saves an edited form over the record it came from, then closes and says so, with Undo. */
function useSaveForm(entry: BookEntry) {
  const { update } = useBookWrites()
  const notify = useToast()
  const [error, setError] = useState<string | null>(null)
  const save = async (form: EditForm, text: string, close: () => void) => {
    setError(null)
    const result = recordFromForm(entry.value, form)
    if ('error' in result) return setError(result.error)
    // Nothing changed: nothing to write.
    if (JSON.stringify(result.record) === JSON.stringify(entry.value)) return close()
    try {
      const after = await update.mutateAsync({ entry, next: result.record })
      close()
      notify(text, { undo: () => update.mutateAsync({ entry: after, next: entry.value }) })
    } catch (err) {
      setError(describeError(err).message)
    }
  }
  return { save, error, saving: update.isPending }
}

function Actions({ saving, close }: { saving: boolean; close: () => void }) {
  return (
    <div className="dialog-actions">
      <button type="button" className="btn btn-quiet btn-sm" onClick={close}>
        Not now
      </button>
      <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

/** You've read it, with no review yet: how was it? Stars, a review and the day you finished. */
function ReviewPrompt({ entry, onClose }: { entry: BookEntry; onClose: () => void }) {
  const initial = formFromRecord(entry.value)
  const [stars, setStars] = useState(initial.stars)
  const [review, setReview] = useState(initial.review)
  const [finishedAt, setFinishedAt] = useState(initial.finishedAt || today())
  const { save, error, saving } = useSaveForm(entry)
  const id = useId()
  return (
    <Dialog title={`How was ${entry.value.title}?`} sub="Rate it and say a few words, if you like. It's saved to your PDS, so it shows on BookHive too." onClose={onClose}>
      {(close) => (
        <form
          className="stack prompt-form"
          onSubmit={(e) => {
            e.preventDefault()
            void save({ ...initial, stars, review, finishedAt }, review.trim() ? 'Saved your review' : stars ? 'Saved your rating' : 'Saved', close)
          }}
        >
          <div className="field">
            <span className="label">Rating</span>
            <StarInput value={stars} onChange={setStars} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-review`}>Review</label>
            <textarea id={`${id}-review`} className="input" rows={4} value={review} onChange={(e) => setReview(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-finished`}>Finished</label>
            <input
              id={`${id}-finished`}
              className="input"
              type="date"
              max={today()}
              min={initial.startedAt || undefined}
              value={finishedAt}
              onChange={(e) => setFinishedAt(e.target.value)}
            />
          </div>
          {error && (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          )}
          <Actions saving={saving} close={close} />
        </form>
      )}
    </Dialog>
  )
}

/** You've given up on it: where did you stop, and why? How far you got is saved as progress; why, as your review. */
function StoppedPrompt({ entry, totalPages, onClose }: { entry: BookEntry; totalPages?: number; onClose: () => void }) {
  const initial = formFromRecord(entry.value)
  const [pagesMode, setPagesMode] = useState(!initial.percent || initial.totalPages !== '')
  const [page, setPage] = useState(initial.currentPage)
  const [total, setTotal] = useState(initial.totalPages || (totalPages ? String(totalPages) : ''))
  const [percent, setPercent] = useState(initial.percent)
  const [review, setReview] = useState(initial.review)
  const { save, error, saving } = useSaveForm(entry)
  const id = useId()
  const digits = (value: string) => value.replace(/\D/g, '')
  return (
    <Dialog
      title="Where did you stop?"
      sub={`${entry.value.title}. How far you got is saved as your progress, which friends deciding whether to read it see in Ask around.`}
      onClose={onClose}
    >
      {(close) => (
        <form
          className="stack prompt-form"
          onSubmit={(e) => {
            e.preventDefault()
            const form = pagesMode
              ? { ...initial, currentPage: page, totalPages: page ? total : '', percent: '', review }
              : { ...initial, currentPage: '', totalPages: '', percent, review }
            void save(form, 'Saved where you stopped', close)
          }}
        >
          {pagesMode ? (
            <div className="row">
              <label htmlFor={`${id}-page`}>Page</label>
              <input id={`${id}-page`} className="input page-input" inputMode="numeric" value={page} onChange={(e) => setPage(digits(e.target.value))} />
              <span>of</span>
              <input
                className="input page-input"
                inputMode="numeric"
                aria-label="Total pages"
                placeholder="—"
                value={total}
                onChange={(e) => setTotal(digits(e.target.value))}
              />
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setPagesMode(false)}>
                Use %
              </button>
            </div>
          ) : (
            <div className="row">
              <label htmlFor={`${id}-percent`}>How far</label>
              <input
                id={`${id}-percent`}
                className="input page-input"
                inputMode="numeric"
                value={percent}
                onChange={(e) => setPercent(digits(e.target.value).slice(0, 3))}
              />
              <span>%</span>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setPagesMode(true)}>
                Use pages
              </button>
            </div>
          )}
          <div className="field">
            <label htmlFor={`${id}-why`}>
              Why? <span className="muted small">(optional, saved as your review)</span>
            </label>
            <textarea id={`${id}-why`} className="input" rows={3} value={review} onChange={(e) => setReview(e.target.value)} />
          </div>
          {error && (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          )}
          <Actions saving={saving} close={close} />
        </form>
      )}
    </Dialog>
  )
}
