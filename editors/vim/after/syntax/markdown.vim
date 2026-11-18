" Highlighting of ZoomDown containers, directives and attributes on top of Markdown.
syntax match zoomdownContainer /^\s*:::\s*\%(slide\|styles\)\?/ contains=zoomdownKeyword
syntax match zoomdownKeyword /\<\%(slide\|styles\)\>/ contained
syntax match zoomdownDirective /^\s*\[\[[a-z_]\+:/ contains=zoomdownDirectiveName
syntax match zoomdownDirectiveName /[a-z_]\+/ contained
syntax match zoomdownDirectiveEnd /\]\]\s*$/
syntax match zoomdownId /#[[:alpha:]_][[:alnum:]_.-]*/
syntax match zoomdownAttribute /\<[[:alpha:]_][[:alnum:]_-]*\ze=/
syntax match zoomdownArrow /->/

highlight default link zoomdownContainer PreProc
highlight default link zoomdownKeyword Keyword
highlight default link zoomdownDirective PreProc
highlight default link zoomdownDirectiveName Keyword
highlight default link zoomdownDirectiveEnd PreProc
highlight default link zoomdownId Identifier
highlight default link zoomdownAttribute Type
highlight default link zoomdownArrow Operator
