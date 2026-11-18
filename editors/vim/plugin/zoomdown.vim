" zoomdown.vim — live preview and export of ZoomDown decks from Vim and Neovim.
"
"   :ZoomDownPreview  (<leader>zb, Ctrl+Alt+B)  serve the deck; the browser reloads on save
"   :ZoomDownJump     (<leader>zj, Ctrl+Alt+J)  show the stop of the cursor line in the browser
"   :ZoomDownBuild    (<leader>zp, Ctrl+Alt+P)  export one self-contained HTML file to ./build
"
" Buffers whose first lines open a slide or styles block get the mappings and
" are saved automatically after `updatetime` idle milliseconds (default 1 s).
" The preview is started with an editor command for the inverse search: E, or
" Alt+click on an element, in the browser moves this Vim to the source line.
" That needs a server name: Neovim always has one; Vim needs +clientserver and
" `vim --servername NAME` (gvim and MacVim set one by themselves).
" Install: copy the `plugin` and `after` folders into ~/.vim or ~/.config/nvim
" (or point your plugin manager at ZoomDown/editors/vim).

if exists('g:loaded_zoomdown') | finish | endif
let g:loaded_zoomdown = 1

let g:zoomdown_command = get(g:, 'zoomdown_command', 'zoomdown')
let g:zoomdown_autosave = get(g:, 'zoomdown_autosave', 1)
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

" The command that runs zoomdown: g:zoomdown_command when set to something else, the command on
" Vim's path, the checkout this plugin belongs to (bin/zoomdown.mjs run with node), or the login shell's.
function! zoomdown#Command() abort
  if g:zoomdown_command !=# 'zoomdown' | return g:zoomdown_command | endif
  if exists('s:resolved') | return s:resolved | endif
  if executable('zoomdown')
    let s:resolved = 'zoomdown'
  else
    let l:cli = simplify(s:plugin_dir . '/../../../bin/zoomdown.mjs')
    let l:node = executable('node') ? 'node' : s:LoginShellWhich('node')
    if filereadable(l:cli) && !empty(l:node)
      let s:resolved = shellescape(l:node) . ' ' . shellescape(l:cli)
    else
      let l:found = s:LoginShellWhich('zoomdown')
      if empty(l:found)
        throw 'Cannot find the zoomdown command: run `npm link` in the ZoomDown checkout, or set g:zoomdown_command'
      endif
      let s:resolved = shellescape(l:found)
    endif
  endif
  return s:resolved
endfunction

" The deck is the Markdown file itself: its settings are in its front matter.
function! s:Deck() abort
  return expand('%:p')
endfunction

" The --editor template that opens a line in this Vim through its server, or '' without one.
function! s:EditorCommand() abort
  if empty(v:servername) | return '' | endif
  if !has('nvim') && !has('clientserver') | return '' | endif
  let l:keys = "<C-\\><C-N>:call zoomdown#Open({line}, '{file}')<CR>"
  if has('nvim')
    return '"' . v:progpath . '" --server "' . v:servername . '" --remote-send "' . l:keys . '"'
  endif
  return '"' . v:progpath . '" --servername "' . v:servername . '" --remote-send "' . l:keys . '"'
endfunction

" Called through the server by the inverse search: show FILE at LINE in a window.
function! zoomdown#Open(line, file) abort
  execute 'drop' fnameescape(a:file)
  execute a:line
  normal! zz
  redraw
endfunction

function! s:Run(cmd) abort
  if exists('*jobstart')
    call jobstart(a:cmd)
  elseif exists('*job_start')
    call job_start([&shell, &shellcmdflag, a:cmd])
  else
    call system(a:cmd)
  endif
endfunction

" Forward search: save, then show the stop of the cursor line in the browser.
function! zoomdown#Jump() abort
  update
  call s:Run(zoomdown#Command() . ' jump ' . shellescape(expand('%:p')) . ' ' . line('.'))
  echo 'ZoomDown: line ' . line('.') . ' sent to the preview'
endfunction

function! s:Terminal(cmd) abort
  if has('nvim')
    botright 12split
    execute 'terminal' a:cmd
  else
    execute 'botright terminal ++rows=12' a:cmd
  endif
endfunction

function! zoomdown#Preview() abort
  update
  let l:editor = s:EditorCommand()
  call s:Terminal(zoomdown#Command() . ' serve ' . shellescape(s:Deck()) . (empty(l:editor) ? '' : ' --editor ' . shellescape(l:editor)))
  wincmd p
endfunction

function! zoomdown#Build() abort
  update
  call s:Terminal(zoomdown#Command() . ' build ' . shellescape(s:Deck()) . ' -o ' . shellescape(expand('%:p:h') . '/build') . ' --one-file')
  wincmd p
endfunction

command! ZoomDownPreview call zoomdown#Preview()
command! ZoomDownJump call zoomdown#Jump()
command! ZoomDownBuild call zoomdown#Build()

function! s:IsDeck() abort
  for l:line in getline(1, 5)
    if l:line =~# '^\s*:::\s*\%(slide\|styles\)\>' | return 1 | endif
  endfor
  return 0
endfunction

function! s:Setup() abort
  nnoremap <buffer> <silent> <leader>zb :ZoomDownPreview<CR>
  nnoremap <buffer> <silent> <leader>zj :ZoomDownJump<CR>
  nnoremap <buffer> <silent> <leader>zp :ZoomDownBuild<CR>
  " The Ctrl+Alt keys of the other editor setups, where the terminal or GUI delivers them.
  nnoremap <buffer> <silent> <C-M-b> :ZoomDownPreview<CR>
  nnoremap <buffer> <silent> <C-M-j> :ZoomDownJump<CR>
  nnoremap <buffer> <silent> <C-M-p> :ZoomDownBuild<CR>
  if g:zoomdown_autosave
    if &updatetime > 1000 | set updatetime=1000 | endif
    autocmd CursorHold,CursorHoldI <buffer> silent! update
  endif
endfunction

augroup zoomdown
  autocmd!
  autocmd BufReadPost,BufNewFile *.md if s:IsDeck() | call s:Setup() | endif
augroup END
