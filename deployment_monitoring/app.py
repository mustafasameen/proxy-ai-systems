import gradio as gr  # Import Gradio for building a web interface
from sklearn import datasets  # Import datasets module to load example datasets
from sklearn.svm import SVC  # Import Support Vector Classifier
from sklearn.model_selection import train_test_split  # Import function to split data into training and testing sets
from prometheus_client import start_http_server, Summary, Counter, Gauge  # Import Prometheus metrics

# Define a Prometheus Counter to track the total number of predictions made, categorized by prediction type (class label)
output_counter = Counter('gradio_predictions_total', 'Total number of predictions', ['prediction_type'])

# Define a Prometheus Gauge to track the confidence score of each prediction
confidence_gauge = Gauge('gradio_prediction_confidence', 'Confidence score of the prediction')

# Define a Prometheus Counter for user feedback, now includes metadata
feedback_counter = Counter(
    'gradio_feedback_total', 
    'Total number of feedback entries received', 
    ['feedback_type', 'predicted_species', 'feedback_excerpt']
)

# Load the Iris dataset
iris = datasets.load_iris()  # Load the built-in Iris dataset
X_train, X_test, y_train, y_test = train_test_split(iris.data, iris.target, test_size=0.2, random_state=42)  
# Split the data into training and testing sets (80% train, 20% test)

# Initialize and train a Support Vector Classifier with a linear kernel
model = SVC(kernel='linear', probability=True)  # Enable probability estimates for confidence calculation
model.fit(X_train, y_train)  # Train the model on the training set

# Create a Prometheus Summary to track time spent processing each request
REQUEST_TIME = Summary('request_processing_seconds', 'Time spent processing request')

# Start Prometheus metrics server to expose metrics on port 8000
start_http_server(8000)

@REQUEST_TIME.time()  # Decorator to measure time spent in this function
def classify_iris(sepal_length, sepal_width, petal_length, petal_width):
    """
    Predict the species of an Iris flower based on its measurements.
    """
    # Prepare input data for the model
    input_data = [[sepal_length, sepal_width, petal_length, petal_width]]
   
    # Make a prediction and get the predicted class label
    prediction = model.predict(input_data)[0]
    prediction_label = iris.target_names[prediction]  # Convert the prediction to the corresponding class name
   
    # Update the Prometheus Counter for the predicted class
    output_counter.labels(prediction_type=prediction_label).inc()

    # Get probabilities for all classes and the confidence of the prediction
    probabilities = model.predict_proba(input_data)[0]
    confidence = max(probabilities)  # Get the highest probability as confidence
    confidence_gauge.set(confidence)  # Update the Prometheus Gauge with the confidence score
   
    # Return the class label with the highest probability and its confidence
    return f"Predicted species: {iris.target_names[probabilities.argmax()]} (Confidence: {confidence:.2f})"

def collect_feedback(predicted_species, feedback_type, open_feedback):
    """
    Collect user feedback on the prediction.
    """
    # Truncate open feedback to 50 characters for use as a label
    feedback_excerpt = open_feedback[:50] if open_feedback else "No additional feedback"
    
    # Increment Prometheus counter with feedback details
    feedback_counter.labels(
        feedback_type=feedback_type,
        predicted_species=predicted_species,
        feedback_excerpt=feedback_excerpt
    ).inc()
    
    print(f"Feedback: {open_feedback} | Type: {feedback_type} for Prediction: {predicted_species}")
    return "Thank you for your feedback!"

# Create Gradio interfaces for both classification and feedback
predict_interface = gr.Interface(
    fn=classify_iris,
    inputs=[
        gr.Slider(4.0, 8.0, step=0.1, label="Sepal Length (cm)"),
        gr.Slider(2.0, 4.5, step=0.1, label="Sepal Width (cm)"),
        gr.Slider(1.0, 7.0, step=0.1, label="Petal Length (cm)"),
        gr.Slider(0.1, 2.5, step=0.1, label="Petal Width (cm)")
    ],
    outputs="text",
    title="Iris Species Classifier",
    description="Enter the measurements of an Iris flower to predict its species."
)

feedback_interface = gr.Interface(
    fn=collect_feedback,
    inputs=[
        gr.Textbox(label="Predicted Species", placeholder="Enter the predicted species"),
        gr.Radio(choices=["Good", "Bad"], label="Feedback Type"),  # Radio button for Good/Bad
        gr.Textbox(label="Additional Feedback", placeholder="Provide additional feedback here")
    ],
    outputs="text",
    title="Feedback Collector",
    description="Provide feedback on the model's prediction."
)

# Combine both interfaces into a tabbed interface
gr.TabbedInterface([predict_interface, feedback_interface], ["Predict", "Feedback"]).launch(server_name="0.0.0.0", server_port=7860)
