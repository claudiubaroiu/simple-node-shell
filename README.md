 This project is a custom Unix-like shell implemented in Node.js, designed to replicate the behavior of essential command-line utilities while supporting advanced features typically found in real shells. 
It includes a fully interactive prompt, support for parsing complex command structures, and execution of both built-in commands and programs found in the system’s PATH. The shell handles quoting, escaping, argument parsing, command history, tab-completion, and command execution via child processes.
 
 It also implements file redirection, error redirection, and multi-stage pipelines, allowing commands like ls | grep .js > out.txt to behave similarly to Bash. Built-in commands such as echo, pwd, type, cd, and an extended history implementation are included, each developed to closely mimic their real counterparts. 
The project provides support for both absolute and relative paths, including ./, ../, and ~, enabling reliable directory navigation. Its command history system can read, write, and append to history files, meaning shell sessions can persist between runs. 
Overall, this shell aims to be a functional learning tool and an accessible demonstration of how real shells tokenize input, spawn processes, redirect streams, and manage pipelines.

**How to Run
**

To start the shell, simply execute the Node.js script in your terminal:

    node main.js


You will be presented with a $ prompt where you can run built-in commands, system executables, or combinations using pipes and redirections. The shell operates entirely inside the terminal and behaves similarly to a lightweight Bash-style environment.
