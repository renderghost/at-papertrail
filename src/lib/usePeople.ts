import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth, useMaybeSession, useSession } from './auth'
import { getAuthorBooks } from './bookhive/api'
import { loadBylineDirectory } from './byline'
import { loadPopfeedProfile, saveFavourites, type FavouriteBook, type ProfileRecord } from './favourites'
import { FEATURES } from './features'
import { follow, followUri, unfollow } from './follows'
import { WRITE_SCOPES } from './oauthConfig'
import { grants } from './scopes'

const HOUR = 60 * 60 * 1000

/**
 * Whether the signed-in session may write to a collection. Sessions from
 * before Papertrail asked for lists, favourites and follows lack those
 * scopes; `reconsent` signs in again to grant them and comes back here.
 */
export function useCanWrite(scope: keyof typeof WRITE_SCOPES) {
  const me = useMaybeSession()
  const { startOAuthSignIn } = useAuth()
  const allowed = !!me && grants(me.session.scope, WRITE_SCOPES[scope])
  return {
    allowed,
    reconsent: () => {
      if (me) void startOAuthSignIn(me.session.handle, window.location.pathname + window.location.search)
    },
  }
}

export function usePopfeedProfile(did: string | undefined) {
  return useQuery({
    queryKey: ['popfeed-profile', did],
    queryFn: ({ signal }) => loadPopfeedProfile(did!, signal),
    enabled: !!did,
    staleTime: 5 * 60 * 1000,
  })
}

export function useSaveFavourites() {
  const { did, session } = useSession()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ profile, books }: { profile: ProfileRecord; books: FavouriteBook[] }) => saveFavourites(session, profile, books),
    onSuccess: (profile) => queryClient.setQueryData(['popfeed-profile', did], profile),
    onError: () => queryClient.invalidateQueries({ queryKey: ['popfeed-profile', did] }),
  })
}

/** Byline's author directory; never fetched while the feature is off (#94). */
export function useByline() {
  return useQuery({ queryKey: ['byline'], queryFn: () => loadBylineDirectory(), staleTime: 6 * HOUR, retry: false, enabled: FEATURES.byline })
}

/** Whether the signed-in reader follows `subject`, and a toggle. */
export function useFollow(subject: string | undefined) {
  const me = useMaybeSession()
  const queryClient = useQueryClient()
  const key = ['follow', me?.did, subject]
  const state = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => followUri(me!.did, subject!, signal),
    enabled: !!me && !!subject && me.did !== subject,
    staleTime: 5 * 60 * 1000,
  })
  const toggle = useMutation({
    mutationFn: async () => {
      if (!me || !subject) throw new Error('Sign in to follow')
      if (state.data) {
        await unfollow(me.session, state.data)
        return null
      }
      return follow(me.session, subject)
    },
    onSuccess: (uri) => queryClient.setQueryData(key, uri),
  })
  return { following: !!state.data, ready: state.isSuccess, toggle }
}

/** BookHive's books by an author, via the relay. */
export function useAuthorBooks(name: string | undefined) {
  return useQuery({
    queryKey: ['author-books', name],
    queryFn: ({ signal }) => getAuthorBooks(name!, signal),
    enabled: !!name,
    staleTime: 6 * HOUR,
    retry: false,
  })
}
