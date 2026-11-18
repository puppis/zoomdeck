;;; zoomdown.el --- Edit ZoomDown decks with live preview and export  -*- lexical-binding: t; -*-

;; Keywords: multimedia, outlines
;; Package-Requires: ((emacs "27.1"))

;;; Commentary:

;; `zoomdown-mode' derives from `markdown-mode' when it is installed (plain
;; `text-mode' otherwise) and adds:
;;
;;   C-c C-b   zoomdown-preview   serve the deck; the browser reloads on save
;;   C-c C-j   zoomdown-jump      show the stop of the current line in the browser
;;   C-c C-p   zoomdown-build     export one self-contained HTML file
;;   C-c C-k   zoomdown-stop      stop the preview server
;;
;; The same three commands are also on C-M-b, C-M-j and C-M-p (Ctrl+Alt+B, J, P), the keys
;; of the other editor setups, in deck buffers only; `zoomdown-ctrl-alt-keys' turns that off.
;;
;; plus highlighting of slide containers, directives and attributes, and an
;; idle autosave (`zoomdown-autosave-mode') so the browser follows your typing.
;; The preview is started with an editor command for the inverse search: E, or
;; Alt+click on an element, in the browser brings Emacs to the source line
;; (through the Emacs server, started if needed; see `zoomdown-inverse-search').
;;
;; Install: (add-to-list 'load-path "/path/to/ZoomDown/editors/emacs")
;;          (require 'zoomdown)
;; Files that open with `::: slide' or `::: styles' use the mode automatically.

;;; Code:

(require 'compile)
(require 'cl-lib)

(defgroup zoomdown nil "ZoomDown decks." :group 'text)

(defcustom zoomdown-command "zoomdown"
  "The zoomdown command: the global binary, or e.g. \"node /path/to/bin/zoomdown.mjs\".
Left at \"zoomdown\", the command is looked up on Emacs's own path, then in the
ZoomDown checkout this file belongs to (its bin/zoomdown.mjs run with node), then
on the path of your login shell, which a graphical Emacs often does not inherit."
  :type 'string)

(defconst zoomdown--directory
  (file-name-directory (or load-file-name (bound-and-true-p byte-compile-current-file) buffer-file-name ""))
  "The folder this file was loaded from, to find the checkout's own command line.")

(defvar zoomdown--resolved nil "The command line found by `zoomdown--command', cached.")

(defun zoomdown--login-shell-which (program)
  "PROGRAM's full path according to the user's login shell, or nil.
Reads the shell's startup files, where nvm and npm usually add their folders to PATH."
  (let* ((shell (or (getenv "SHELL") "/bin/sh"))
         (output (ignore-errors
                   (with-temp-buffer
                     (call-process shell nil t nil "-lic" (format "command -v %s" (shell-quote-argument program)))
                     (buffer-string))))
         (candidates (and output (reverse (split-string output "\n" t)))))
    (cl-find-if (lambda (line) (and (file-name-absolute-p line) (file-executable-p line))) candidates)))

(defun zoomdown--command ()
  "The command line prefix that runs zoomdown, see `zoomdown-command'."
  (or (and (not (equal zoomdown-command "zoomdown")) zoomdown-command)
      zoomdown--resolved
      (setq zoomdown--resolved
            (let ((global (executable-find "zoomdown")))
              (cond
               (global (shell-quote-argument global))
               ((let* ((cli (expand-file-name "../../bin/zoomdown.mjs" zoomdown--directory))
                       (node (and (file-exists-p cli)
                                  (or (executable-find "node") (zoomdown--login-shell-which "node")))))
                  (and node (format "%s %s" (shell-quote-argument node) (shell-quote-argument cli)))))
               ((let ((found (zoomdown--login-shell-which "zoomdown")))
                  (and found (shell-quote-argument found))))
               (t (user-error "Cannot find the zoomdown command: run `npm link' in the ZoomDown checkout, or set `zoomdown-command' to e.g. \"node /path/to/ZoomDown/bin/zoomdown.mjs\"")))))))

(defcustom zoomdown-build-directory "build"
  "Folder, relative to the deck, where `zoomdown-build' writes the export."
  :type 'string)

(defcustom zoomdown-autosave t
  "Whether `zoomdown-mode' saves the buffer after `zoomdown-autosave-delay' idle seconds."
  :type 'boolean)

(defcustom zoomdown-autosave-delay 1
  "Idle seconds before an edited deck is saved."
  :type 'number)

(defcustom zoomdown-ctrl-alt-keys t
  "Whether deck buffers also bind C-M-b, C-M-j and C-M-p to preview, jump and build.
These are the Ctrl+Alt+B, J and P of the other editor setups; in a deck buffer they shadow
`backward-sexp', `default-indent-new-line' and `backward-list'."
  :type 'boolean)

(defcustom zoomdown-inverse-search t
  "Whether the preview opens source lines in this Emacs (E or Alt+click in the browser).
Starts the Emacs server when it is not running, so that emacsclient can reach this session."
  :type 'boolean)

(defun zoomdown--emacsclient ()
  "The emacsclient that belongs to this Emacs, falling back to the one on the path."
  (or (cl-find-if #'file-executable-p
                  (list (expand-file-name "emacsclient" invocation-directory)
                        (expand-file-name "bin/emacsclient" invocation-directory)
                        (expand-file-name "../bin/emacsclient" invocation-directory)))
      (executable-find "emacsclient")
      "emacsclient"))

(defun zoomdown--editor-command ()
  "The `--editor' template through which the preview opens a line in this Emacs, or nil."
  (when zoomdown-inverse-search
    (require 'server)
    (unless (bound-and-true-p server-process) (server-start))
    (format "\"%s\" --no-wait %s +{line} {file}"
            (zoomdown--emacsclient)
            (if (bound-and-true-p server-use-tcp)
                (format "--server-file=%s" server-name)
              (format "--socket-name=%s" server-name)))))

(defconst zoomdown-font-lock-keywords
  `(("^[ \t]*\\(:::\\)[ \t]*\\(slide\\|styles\\)?"
     (1 font-lock-preprocessor-face) (2 font-lock-keyword-face nil t))
    ("^[ \t]*\\(\\[\\[\\)\\([a-z_]+\\)\\(:\\)"
     (1 font-lock-preprocessor-face) (2 font-lock-keyword-face) (3 font-lock-preprocessor-face))
    ("\\]\\][ \t]*$" . font-lock-preprocessor-face)
    ("#[[:alpha:]_][[:alnum:]_.-]*" . font-lock-function-name-face)
    ("\\_<\\([[:alpha:]_][[:alnum:]_-]*\\)\\(=\\)" (1 font-lock-variable-name-face))
    ("->" . font-lock-keyword-face))
  "Highlighting for containers, directives, IDs and attributes.")

(defun zoomdown--deck-file ()
  "The deck to serve or build: the buffer's Markdown file, its settings in its front matter."
  (or (buffer-file-name) (user-error "Save the deck to a file first")))

(defun zoomdown--run (buffer-name command)
  "Run COMMAND from the deck's directory in a compilation buffer named BUFFER-NAME."
  (let ((default-directory (file-name-directory (zoomdown--deck-file))))
    (compilation-start command nil (lambda (_mode) buffer-name))))

;;;###autoload
(defun zoomdown-preview ()
  "Serve the current deck; the browser opens, reloads on every save and keeps its position.
With `zoomdown-inverse-search', the browser's E key and Alt+click open lines here."
  (interactive)
  (let ((editor (zoomdown--editor-command)))
    (zoomdown--run "*zoomdown preview*"
                   (format "%s serve %s%s" (zoomdown--command) (shell-quote-argument (zoomdown--deck-file))
                           (if editor (format " --editor %s" (shell-quote-argument editor)) "")))))

;;;###autoload
(defun zoomdown-jump ()
  "Show the stop of the current line in the browser (forward search).
Saves the buffer first, so the preview shows what you see; the deck must be served
by `zoomdown-preview' or `zoomdown serve'."
  (interactive)
  (let ((file (or (buffer-file-name) (user-error "Save the deck to a file first")))
        (line (save-restriction (widen) (line-number-at-pos))))
    (when (buffer-modified-p) (let ((inhibit-message t)) (save-buffer)))
    (let ((process (start-process-shell-command
                    "zoomdown-jump" " *zoomdown jump*"
                    (format "%s jump %s %d" (zoomdown--command) (shell-quote-argument file) line))))
      (set-process-sentinel
       process
       (lambda (proc _event)
         (unless (process-live-p proc)
           (if (zerop (process-exit-status proc))
               (message "ZoomDown: line %d sent to the preview" line)
             (message "ZoomDown: %s" (string-trim (with-current-buffer (process-buffer proc) (buffer-string))))))
         (when (buffer-live-p (process-buffer proc))
           (with-current-buffer (process-buffer proc) (erase-buffer))))))))

;;;###autoload
(defun zoomdown-build ()
  "Export the current deck as one self-contained HTML file in `zoomdown-build-directory'."
  (interactive)
  (zoomdown--run "*zoomdown build*"
                 (format "%s build %s -o %s --one-file" (zoomdown--command)
                         (shell-quote-argument (zoomdown--deck-file))
                         (shell-quote-argument zoomdown-build-directory))))

(defun zoomdown-stop ()
  "Stop the preview server started by `zoomdown-preview'."
  (interactive)
  (let ((buffer (get-buffer "*zoomdown preview*")))
    (if (and buffer (get-buffer-process buffer))
        (interrupt-process (get-buffer-process buffer))
      (message "No preview server is running"))))

(defvar zoomdown--autosave-timer nil)

(defun zoomdown--autosave ()
  "Save every modified deck buffer."
  (dolist (buffer (buffer-list))
    (with-current-buffer buffer
      (when (and (derived-mode-p 'zoomdown-mode) zoomdown-autosave-mode
                 (buffer-file-name) (buffer-modified-p))
        (let ((inhibit-message t)) (save-buffer))))))

(define-minor-mode zoomdown-autosave-mode
  "Save the deck after `zoomdown-autosave-delay' idle seconds, so the preview follows typing."
  :lighter " ⟳"
  (when zoomdown--autosave-timer
    (cancel-timer zoomdown--autosave-timer)
    (setq zoomdown--autosave-timer nil))
  (when (cl-some (lambda (b) (buffer-local-value 'zoomdown-autosave-mode b)) (buffer-list))
    (setq zoomdown--autosave-timer
          (run-with-idle-timer zoomdown-autosave-delay t #'zoomdown--autosave))))

(defvar zoomdown-mode-map
  (let ((map (make-sparse-keymap)))
    (define-key map (kbd "C-c C-b") #'zoomdown-preview)
    (define-key map (kbd "C-c C-j") #'zoomdown-jump)
    (define-key map (kbd "C-c C-p") #'zoomdown-build)
    (define-key map (kbd "C-c C-k") #'zoomdown-stop)
    map)
  "Keymap of `zoomdown-mode'.")

(defalias 'zoomdown--parent-mode (if (fboundp 'markdown-mode) 'markdown-mode 'text-mode))

;;;###autoload
(define-derived-mode zoomdown-mode zoomdown--parent-mode "ZoomDown"
  "Major mode for ZoomDown decks: Markdown plus containers, directives and a live preview."
  (font-lock-add-keywords nil zoomdown-font-lock-keywords)
  (when zoomdown-ctrl-alt-keys
    (let ((map (make-sparse-keymap)))
      (set-keymap-parent map zoomdown-mode-map)
      (define-key map (kbd "C-M-b") #'zoomdown-preview)
      (define-key map (kbd "C-M-j") #'zoomdown-jump)
      (define-key map (kbd "C-M-p") #'zoomdown-build)
      (use-local-map map)))
  (when zoomdown-autosave (zoomdown-autosave-mode 1)))

;;;###autoload
(add-to-list 'magic-mode-alist
             '("\\`\\(?:<!--[^z-a]*?-->[ \t\n]*\\)?:::[ \t]*\\(?:slide\\|styles\\)\\b" . zoomdown-mode))

(provide 'zoomdown)
;;; zoomdown.el ends here
