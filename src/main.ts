// Style sheets
import "leaflet/dist/leaflet.css";
import "./style.css";

// Create a button element on the page that user can click to see a message
const button = document.createElement("button");
button.textContent = "Click me!";

// change the text color of the button
button.style.color = "red";

document.body.appendChild(button);

// Add a click event listener to the button
button.addEventListener("click", () => {
  alert("YOU CLICKED ME!");
});
