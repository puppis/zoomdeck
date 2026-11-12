;;; zoomdeck.el --- Edit Zoomdeck decks with live preview and export  -*- lexical-binding: t; -*-

;; Keywords: multimedia, outlines
;; Package-Requires: ((emacs "27.1"))

;;; Commentary:

;; `zoomdeck-mode' derives from `markdown-mode' when it is installed (plain
;; `text-mode' otherwise) and adds:
;;
;;   C-c C-b   zoomdeck-preview   serve the deck; the browser reloads on save
;;   C-c C-j   zoomdeck-jump      show the stop of the current line in the browser
;;   C-c C-p   zoomdeck-build     export one self-contained HTML file
;;   C-c C-k   zoomdeck-stop      stop the preview server
;;
;; The same three commands are also on C-M-b, C-M-j and C-M-p (Ctrl+Alt+B, J, P), the keys
;; of the other editor setups, in deck buffers only; `zoomdeck-ctrl-alt-keys' turns that off.
;;
;; plus highlighting of slide containers, directives and attributes, and an
;; idle autosave (`zoomdeck-autosave-mode') so the browser follows your typing.
;; The preview is started with an editor command for the inverse search: E, or
;; Alt+click on an element, in the browser brings Emacs to the source line
;; (through the Emacs server, started if needed; see `zoomdeck-inverse-search').
;;
;; Install: (add-to-list 'load-path "/path/to/Zoomdeck/editors/emacs")
;;          (require 'zoomdeck)
;; Files that open with `::: slide' or `::: styles' use the mode automatically.

;;; Code:

(require 'compile)
(require 'cl-lib)

(defgroup zoomdeck nil "Zoomdeck decks." :group 'text)

(defcustom zoomdeck-command "zoomdeck"
  "The zoomdeck command: the global binary, or e.g. \"node /path/to/bin/zoomdeck.mjs\".
Left at \"zoomdeck\", the command is looked up on Emacs's own path, then in the
Zoomdeck checkout this file belongs to (its bin/zoomdeck.mjs run with node), then
on the path of your login shell, which a graphical Emacs often does not inherit."
  :type 'string)

(defconst zoomdeck--directory
  (file-name-directory (or load-file-name (bound-and-true-p byte-compile-current-file) buffer-file-name ""))
  "The folder this file was loaded from, to find the checkout's own command line.")

(defvar zoomdeck--resolved nil "The command line found by `zoomdeck--command', cached.")

(defun zoomdeck--login-shell-which (program)
  "PROGRAM's full path according to the user's login shell, or nil.
Reads the shell's startup files, where nvm and npm usually add their folders to PATH."
  (let* ((shell (or (getenv "SHELL") "/bin/sh"))
         (output (ignore-errors
                   (with-temp-buffer
                     (call-process shell nil t nil "-lic" (format "command -v %s" (shell-quote-argument program)))
                     (buffer-string))))
         (candidates (and output (reverse (split-string output "\n" t)))))
    (cl-find-if (lambda (line) (and (file-name-absolute-p line) (file-executable-p line))) candidates)))

(defun zoomdeck--command ()
  "The command line prefix that runs zoomdeck, see `zoomdeck-command'."
  (or (and (not (equal zoomdeck-command "zoomdeck")) zoomdeck-command)
      zoomdeck--resolved
      (setq zoomdeck--resolved
            (let ((global (executable-find "zoomdeck")))
              (cond
               (global (shell-quote-argument global))
               ((let* ((cli (expand-file-name "../../bin/zoomdeck.mjs" zoomdeck--directory))
                       (node (and (file-exists-p cli)
                                  (or (executable-find "node") (zoomdeck--login-shell-which "node")))))
                  (and node (format "%s %s" (shell-quote-argument node) (shell-quote-argument cli)))))
               ((let ((found (zoomdeck--login-shell-which "zoomdeck")))
                  (and found (shell-quote-argument found))))
               (t (user-error "Cannot find the zoomdeck command: run `npm link' in the Zoomdeck checkout, or set `zoomdeck-command' to e.g. \"node /path/to/Zoomdeck/bin/zoomdeck.mjs\"")))))))

(defcustom zoomdeck-build-directory "build"
  "Folder, relative to the deck, where `zoomdeck-build' writes the export."
  :type 'string)

(defcustom zoomdeck-autosave t
  "Whether `zoomdeck-mode' saves the buffer after `zoomdeck-autosave-delay' idle seconds."
  :type 'boolean)

(defcustom zoomdeck-autosave-delay 1
  "Idle seconds before an edited deck is saved."
  :type 'number)

(defcustom zoomdeck-ctrl-alt-keys t
  "Whether deck buffers also bind C-M-b, C-M-j and C-M-p to preview, jump and build.
These are the Ctrl+Alt+B, J and P of the other editor setups; in a deck buffer they shadow
`backward-sexp', `default-indent-new-line' and `backward-list'."
  :type 'boolean)

(defcustom zoomdeck-inverse-search t
  "Whether the preview opens source lines in this Emacs (E or Alt+click in the browser).
Starts the Emacs server when it is not running, so that emacsclient can reach this session."
  :type 'boolean)

(defun zoomdeck--emacsclient ()
  "The emacsclient that belongs to this Emacs, falling back to the one on the path."
  (or (cl-find-if #'file-executable-p
                  (list (expand-file-name "emacsclient" invocation-directory)
                        (expand-file-name "bin/emacsclient" invocation-directory)
                        (expand-file-name "../bin/emacsclient" invocation-directory)))
      (executable-find "emacsclient")
      "emacsclient"))

(defun zoomdeck--editor-command ()
  "The `--editor' template through which the preview opens a line in this Emacs, or nil."
  (when zoomdeck-inverse-search
    (require 'server)
    (unless (bound-and-true-p server-process) (server-start))
    (format "\"%s\" --no-wait %s +{line} {file}"
            (zoomdeck--emacsclient)
            (if (bound-and-true-p server-use-tcp)
                (format "--server-file=%s" server-name)
              (format "--socket-name=%s" server-name)))))

(defconst zoomdeck-font-lock-keywords
  `(("^[ \t]*\\(:::\\)[ \t]*\\(slide\\|styles\\)?"
     (1 font-lock-preprocessor-face) (2 font-lock-keyword-face nil t))
    ("^[ \t]*\\(\\[\\[\\)\\([a-z_]+\\)\\(:\\)"
     (1 font-lock-preprocessor-face) (2 font-lock-keyword-face) (3 font-lock-preprocessor-face))
    ("\\]\\][ \t]*$" . font-lock-preprocessor-face)
    ("#[[:alpha:]_][[:alnum:]_.-]*" . font-lock-function-name-face)
    ("\\_<\\([[:alpha:]_][[:alnum:]_-]*\\)\\(=\\)" (1 font-lock-variable-name-face))
    ("->" . font-lock-keyword-face))
  "Highlighting for containers, directives, IDs and attributes.")

(defun zoomdeck--deck-file ()
  "The deck to serve or build: deck.json next to the buffer's file when present, else the file."
  (let* ((file (or (buffer-file-name) (user-error "Save the deck to a file first")))
         (json (expand-file-name "deck.json" (file-name-directory file))))
    (if (file-exists-p json) json file)))

(defun zoomdeck--run (buffer-name command)
  "Run COMMAND from the deck's directory in a compilation buffer named BUFFER-NAME."
  (let ((default-directory (file-name-directory (zoomdeck--deck-file))))
    (compilation-start command nil (lambda (_mode) buffer-name))))

;;;###autoload
(defun zoomdeck-preview ()
  "Serve the current deck; the browser opens, reloads on every save and keeps its position.
With `zoomdeck-inverse-search', the browser's E key and Alt+click open lines here."
  (interactive)
  (let ((editor (zoomdeck--editor-command)))
    (zoomdeck--run "*zoomdeck preview*"
                   (format "%s serve %s%s" (zoomdeck--command) (shell-quote-argument (zoomdeck--deck-file))
                           (if editor (format " --editor %s" (shell-quote-argument editor)) "")))))

;;;###autoload
(defun zoomdeck-jump ()
  "Show the stop of the current line in the browser (forward search).
Saves the buffer first, so the preview shows what you see; the deck must be served
by `zoomdeck-preview' or `zoomdeck serve'."
  (interactive)
  (let ((file (or (buffer-file-name) (user-error "Save the deck to a file first")))
        (line (save-restriction (widen) (line-number-at-pos))))
    (when (buffer-modified-p) (let ((inhibit-message t)) (save-buffer)))
    (let ((process (start-process-shell-command
                    "zoomdeck-jump" " *zoomdeck jump*"
                    (format "%s jump %s %d" (zoomdeck--command) (shell-quote-argument file) line))))
      (set-process-sentinel
       process
       (lambda (proc _event)
         (unless (process-live-p proc)
           (if (zerop (process-exit-status proc))
               (message "Zoomdeck: line %d sent to the preview" line)
             (message "Zoomdeck: %s" (string-trim (with-current-buffer (process-buffer proc) (buffer-string))))))
         (when (buffer-live-p (process-buffer proc))
           (with-current-buffer (process-buffer proc) (erase-buffer))))))))

;;;###autoload
(defun zoomdeck-build ()
  "Export the current deck as one self-contained HTML file in `zoomdeck-build-directory'."
  (interactive)
  (zoomdeck--run "*zoomdeck build*"
                 (format "%s build %s -o %s --one-file" (zoomdeck--command)
                         (shell-quote-argument (zoomdeck--deck-file))
                         (shell-quote-argument zoomdeck-build-directory))))

(defun zoomdeck-stop ()
  "Stop the preview server started by `zoomdeck-preview'."
  (interactive)
  (let ((buffer (get-buffer "*zoomdeck preview*")))
    (if (and buffer (get-buffer-process buffer))
        (interrupt-process (get-buffer-process buffer))
      (message "No preview server is running"))))

(defvar zoomdeck--autosave-timer nil)

(defun zoomdeck--autosave ()
  "Save every modified deck buffer."
  (dolist (buffer (buffer-list))
    (with-current-buffer buffer
      (when (and (derived-mode-p 'zoomdeck-mode) zoomdeck-autosave-mode
                 (buffer-file-name) (buffer-modified-p))
        (let ((inhibit-message t)) (save-buffer))))))

(define-minor-mode zoomdeck-autosave-mode
  "Save the deck after `zoomdeck-autosave-delay' idle seconds, so the preview follows typing."
  :lighter " ⟳"
  (when zoomdeck--autosave-timer
    (cancel-timer zoomdeck--autosave-timer)
    (setq zoomdeck--autosave-timer nil))
  (when (cl-some (lambda (b) (buffer-local-value 'zoomdeck-autosave-mode b)) (buffer-list))
    (setq zoomdeck--autosave-timer
          (run-with-idle-timer zoomdeck-autosave-delay t #'zoomdeck--autosave))))

(defvar zoomdeck-mode-map
  (let ((map (make-sparse-keymap)))
    (define-key map (kbd "C-c C-b") #'zoomdeck-preview)
    (define-key map (kbd "C-c C-j") #'zoomdeck-jump)
    (define-key map (kbd "C-c C-p") #'zoomdeck-build)
    (define-key map (kbd "C-c C-k") #'zoomdeck-stop)
    map)
  "Keymap of `zoomdeck-mode'.")

(defalias 'zoomdeck--parent-mode (if (fboundp 'markdown-mode) 'markdown-mode 'text-mode))

;;;###autoload
(define-derived-mode zoomdeck-mode zoomdeck--parent-mode "Zoomdeck"
  "Major mode for Zoomdeck decks: Markdown plus containers, directives and a live preview."
  (font-lock-add-keywords nil zoomdeck-font-lock-keywords)
  (when zoomdeck-ctrl-alt-keys
    (let ((map (make-sparse-keymap)))
      (set-keymap-parent map zoomdeck-mode-map)
      (define-key map (kbd "C-M-b") #'zoomdeck-preview)
      (define-key map (kbd "C-M-j") #'zoomdeck-jump)
      (define-key map (kbd "C-M-p") #'zoomdeck-build)
      (use-local-map map)))
  (when zoomdeck-autosave (zoomdeck-autosave-mode 1)))

;;;###autoload
(add-to-list 'magic-mode-alist
             '("\\`\\(?:<!--[^z-a]*?-->[ \t\n]*\\)?:::[ \t]*\\(?:slide\\|styles\\)\\b" . zoomdeck-mode))

(provide 'zoomdeck)
;;; zoomdeck.el ends here
