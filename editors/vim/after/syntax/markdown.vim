" Highlighting of Zoomdeck containers, directives and attributes on top of Markdown.
syntax match zoomdeckContainer /^\s*:::\s*\%(slide\|styles\)\?/ contains=zoomdeckKeyword
syntax match zoomdeckKeyword /\<\%(slide\|styles\)\>/ contained
syntax match zoomdeckDirective /^\s*\[\[[a-z_]\+:/ contains=zoomdeckDirectiveName
syntax match zoomdeckDirectiveName /[a-z_]\+/ contained
syntax match zoomdeckDirectiveEnd /\]\]\s*$/
syntax match zoomdeckId /#[[:alpha:]_][[:alnum:]_.-]*/
syntax match zoomdeckAttribute /\<[[:alpha:]_][[:alnum:]_-]*\ze=/
syntax match zoomdeckArrow /->/

highlight default link zoomdeckContainer PreProc
highlight default link zoomdeckKeyword Keyword
highlight default link zoomdeckDirective PreProc
highlight default link zoomdeckDirectiveName Keyword
highlight default link zoomdeckDirectiveEnd PreProc
highlight default link zoomdeckId Identifier
highlight default link zoomdeckAttribute Type
highlight default link zoomdeckArrow Operator
