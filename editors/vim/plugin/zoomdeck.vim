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
let s:plugin_dir = expand('<sfile>:p:h')

" PROGRAM's path according to the login shell (which reads the files where nvm and npm set PATH), or ''.
function! s:LoginShellWhich(program) abort
  let l:shell = empty($SHELL) ? '/bin/sh' : $SHELL
  let l:out = system(shellescape(l:shell) . ' -lic ' . shellescape('command -v ' . a:program) . ' 2>/dev/null')
  for l:line in reverse(split(l:out, "\n"))
    if l:line =~# '^/' && executable(l:line) | return l:line | endif
  endfor
  return ''
endfunction

" The command that runs zoomdeck: g:zoomdeck_command when set to something else, the command on
" Vim's path, the checkout this plugin belongs to (bin/zoomdeck.mjs run with node), or the login shell's.
function! zoomdeck#Command() abort
  if g:zoomdeck_command !=# 'zoomdeck' | return g:zoomdeck_command | endif
  if exists('s:resolved') | return s:resolved | endif
  if executable('zoomdeck')
    let s:resolved = 'zoomdeck'
  else
    let l:cli = simplify(s:plugin_dir . '/../../../bin/zoomdeck.mjs')
    let l:node = executable('node') ? 'node' : s:LoginShellWhich('node')
    if filereadable(l:cli) && !empty(l:node)
      let s:resolved = shellescape(l:node) . ' ' . shellescape(l:cli)
    else
      let l:found = s:LoginShellWhich('zoomdeck')
      if empty(l:found)
        throw 'Cannot find the zoomdeck command: run `npm link` in the Zoomdeck checkout, or set g:zoomdeck_command'
      endif
      let s:resolved = shellescape(l:found)
    endif
  endif
  return s:resolved
endfunction

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
  call s:Terminal(zoomdeck#Command() . ' serve ' . shellescape(s:Deck()))
  wincmd p
endfunction

function! zoomdeck#Build() abort
  update
  call s:Terminal(zoomdeck#Command() . ' build ' . shellescape(s:Deck()) . ' -o ' . shellescape(expand('%:p:h') . '/build') . ' --one-file')
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
