from lightning_app import LightningWork, LightningApp
import subprocess
import time
import os

class FrontendServer(LightningWork):
    def run(self):
        print("Current working directory:", os.getcwd())
        print("Listing files:")
        subprocess.run(["ls", "-l"], shell=True)
        
        print("Installing npm dependencies...")
        install_proc = subprocess.run(
            ["npm", "install"],
            shell=True,
            capture_output=True,
            text=True
        )
        print("npm install output:", install_proc.stdout)
        if install_proc.returncode != 0:
            print("npm install error:", install_proc.stderr)
            return

        print("Starting frontend development server...")
        # Start the dev server with the --host flag to bind to 0.0.0.0
        dev_proc = subprocess.Popen(
            ["npm", "run", "dev", "--", "--host"],
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        # Poll for output without assuming stdout is always available
        for i in range(20):
            if dev_proc.stdout is not None:
                line = dev_proc.stdout.readline()
                if line:
                    print("Server output:", line.strip())
            if dev_proc.stderr is not None:
                err_line = dev_proc.stderr.readline()
                if err_line:
                    print("Server error:", err_line.strip())
            time.sleep(1)

        print("Frontend server should now be running. Keeping process alive...")
        # Keep the work alive indefinitely
        while True:
            time.sleep(10)

class FrontendApp(LightningApp):
    def __init__(self):
        print("Initializing FrontendApp...")
        super().__init__(FrontendServer())

app = FrontendApp()