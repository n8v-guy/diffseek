#!/usr/bin/env python3
"""Smoke-test the packaged Firefox extension against a GitHub PR page."""
import json
import os
from pathlib import Path
import subprocess
import zipfile

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

root = Path(__file__).resolve().parents[1]
package = json.loads((root / "package.json").read_text())
count = int(subprocess.check_output(["git", "rev-list", "--count", "HEAD"], cwd=root, text=True).strip())
major, minor, *_ = package["version"].split(".")
expected_version = f"{major}.{minor}.{count}"
archive_paths = list((root / ".output").glob("*-firefox.zip"))
if len(archive_paths) != 1:
    raise AssertionError(f"Expected one Firefox extension ZIP, found {archive_paths}")
archive = archive_paths[0]
with zipfile.ZipFile(archive) as z:
    bad = z.testzip()
    assert bad is None, f"Corrupt ZIP member: {bad}"
    names = set(z.namelist())
    assert "manifest.json" in names, "Missing manifest.json"
    manifest = json.loads(z.read("manifest.json"))
    assert manifest["manifest_version"] == 3
    assert manifest["version"] == expected_version, (manifest["version"], expected_version)
    assert manifest["browser_specific_settings"]["gecko"]["id"] == "diffseek@n8v.me"
    assert any(name.startswith("content-scripts/") for name in names), "Missing content script"

options = webdriver.FirefoxOptions()
options.add_argument("-headless")
driver = webdriver.Firefox(options=options)
try:
    driver.install_addon(str(archive), temporary=True)
    # This checks the packaged runtime on an actual GitHub review page.
    driver.get(os.environ.get("DIFFSEEK_FIREFOX_SMOKE_URL", "https://github.com/microsoft/vscode/pull/1/files"))
    wait = WebDriverWait(driver, 30)
    filter_button = wait.until(lambda d: next(
        (element for element in d.find_elements(By.CSS_SELECTOR, '[aria-label="Filter options"]')
         if element.is_displayed()), None))
    filter_button.click()
    wait.until(lambda d: any(
        element.is_displayed() for element in d.find_elements(By.CSS_SELECTOR, '[data-diffseek="filters"]')))
finally:
    driver.quit()
