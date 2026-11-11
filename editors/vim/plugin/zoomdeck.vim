" zoomdeck.vim — live preview and export of Zoomdeck decks from Vim and Neovim.
"
"   :ZoomdeckPreview  (<leader>zp)  serve the deck; the browser reloads on save
"   :ZoomdeckBuild    (<leader>zb)  export one self-contained HTML file to ./build
"
" Buffers whose first lines open a slide or styles block get the mappings and
" are saved automatically after `updatetime` idle milliseconds (default 1 s).
" Install: copy the `plugin` and `after` folders into ~/.vim or ~/.config/nvim
" (or point your plugin manager at Zoomdeck/editors/vim).

if exists('g:loaded_zoomdeck') | finish | endif
let g:loaded_zoomdeck = 1

let g:zoomdeck_command = get(g:, 'zoomdeck_command', 'zoomdeck')
let g:zoomdeck_autosave = get(g:, 'zoomdeck_autosave', 1)

function! s:Deck() abort
  let l:json = expand('%:p:h') . '/deck.json'
  return filereadable(l:json) ? l:json : expand('%:p')
endfunction

function! s:Terminal(cmd) abort
  if has('nvim')
    botright 12split
    execute 'terminal' a:cmd
  else
    execute 'botright terminal ++rows=12' a:cmd
  endif
endfunction

function! zoomdeck#Preview() abort
  update
  call s:Terminal(g:zoomdeck_command . ' serve ' . shellescape(s:Deck()))
  wincmd p
endfunction

function! zoomdeck#Build() abort
  update
  call s:Terminal(g:zoomdeck_command . ' build ' . shellescape(s:Deck()) . ' -o ' . shellescape(expand('%:p:h') . '/build') . ' --one-file')
  wincmd p
endfunction

command! ZoomdeckPreview call zoomdeck#Preview()
command! ZoomdeckBuild call zoomdeck#Build()

function! s:IsDeck() abort
  for l:line in getline(1, 5)
    if l:line =~# '^\s*:::\s*\%(slide\|styles\)\>' | return 1 | endif
  endfor
  return 0
endfunction

function! s:Setup() abort
  nnoremap <buffer> <silent> <leader>zp :ZoomdeckPreview<CR>
  nnoremap <buffer> <silent> <leader>zb :ZoomdeckBuild<CR>
  if g:zoomdeck_autosave
    if &updatetime > 1000 | set updatetime=1000 | endif
    autocmd CursorHold,CursorHoldI <buffer> silent! update
  endif
endfunction

augroup zoomdeck
  autocmd!
  autocmd BufReadPost,BufNewFile *.md if s:IsDeck() | call s:Setup() | endif
augroup END
