CXX      = g++
CXXFLAGS = -O2 -Wall
LIBS     = -lraw -ljpeg
TARGET   = nef-thumb

all: $(TARGET)

$(TARGET): nef-thumb.cpp
	$(CXX) $(CXXFLAGS) -o $(TARGET) nef-thumb.cpp $(LIBS)

clean:
	rm -f $(TARGET)
