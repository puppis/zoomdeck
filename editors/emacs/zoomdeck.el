;;; zoomdeck.el --- Edit Zoomdeck decks with live preview and export  -*- lexical-binding: t; -*-

;; Keywords: multimedia, outlines
;; Package-Requires: ((emacs "27.1"))

;;; Commentary:

;; `zoomdeck-mode' derives from `markdown-mode' when it is installed (plain
;; `text-mode' otherwise) and adds:
;;
;;   C-c C-p   zoomdeck-preview   serve the deck; the browser reloads on save
;;   C-c C-b   zoomdeck-build     export one self-contained HTML file
;;   C-c C-k   zoomdeck-stop      stop the preview server
;;
;; plus highlighting of slide containers, directives and attributes, and an
;; idle autosave (`zoomdeck-autosave-mode') so the browser follows your typing.
;;
;; Install: (add-to-list 'load-path "/path/to/Zoomdeck/editors/emacs")
;;          (require 'zoomdeck)
;; Files that open with `::: slide' or `::: styles' use the mode automatically.

;;; Code:

(require 'compile)
(require 'cl-lib)

(defgroup zoomdeck nil "Zoomdeck decks." :group 'text)

(defcustom zoomdeck-command "zoomdeck"
  "The zoomdeck command: the global binary, or e.g. \"node /path/to/bin/zoomdeck.mjs\"."
  :type 'string)

(defcustom zoomdeck-build-directory "build"
  "Folder, relative to the deck, where `zoomdeck-build' writes the export."
  :type 'string)

(defcustom zoomdeck-autosave t
  "Whether `zoomdeck-mode' saves the buffer after `zoomdeck-autosave-delay' idle seconds."
  :type 'boolean)

(defcustom zoomdeck-autosave-delay 1
  "Idle seconds before an edited deck is saved."
  :type 'number)

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
  "Serve the current deck; the browser opens, reloads on every save and keeps its position."
  (interactive)
  (zoomdeck--run "*zoomdeck preview*"
                 (format "%s serve %s" zoomdeck-command (shell-quote-argument (zoomdeck--deck-file)))))

;;;###autoload
(defun zoomdeck-build ()
  "Export the current deck as one self-contained HTML file in `zoomdeck-build-directory'."
  (interactive)
  (zoomdeck--run "*zoomdeck build*"
                 (format "%s build %s -o %s --one-file" zoomdeck-command
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
    (define-key map (kbd "C-c C-p") #'zoomdeck-preview)
    (define-key map (kbd "C-c C-b") #'zoomdeck-build)
    (define-key map (kbd "C-c C-k") #'zoomdeck-stop)
    map)
  "Keymap of `zoomdeck-mode'.")

(defalias 'zoomdeck--parent-mode (if (fboundp 'markdown-mode) 'markdown-mode 'text-mode))

;;;###autoload
(define-derived-mode zoomdeck-mode zoomdeck--parent-mode "Zoomdeck"
  "Major mode for Zoomdeck decks: Markdown plus containers, directives and a live preview."
  (font-lock-add-keywords nil zoomdeck-font-lock-keywords)
  (when zoomdeck-autosave (zoomdeck-autosave-mode 1)))

;;;###autoload
(add-to-list 'magic-mode-alist
             '("\\`\\(?:<!--[^z-a]*?-->[ \t\n]*\\)?:::[ \t]*\\(?:slide\\|styles\\)\\b" . zoomdeck-mode))

(provide 'zoomdeck)
;;; zoomdeck.el ends here
